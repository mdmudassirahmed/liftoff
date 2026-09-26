"""
Assemble frames recorded by scripts/demo/record.mjs into a lightweight GIF.

    python scripts/demo/make_gif.py [framesDir] [out.gif]

Each frame gets a caption strip above it (so the UI is never covered). Frames
are downscaled and share one adaptive palette, which keeps the GIF small and
free of colour flicker. Requires Pillow.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH = 960            # output width; height follows the recording's aspect ratio
CAPTION_H = 46
BG = (15, 23, 42)       # slate-900
ACCENT = (79, 70, 229)  # brand indigo
TEXT = (248, 250, 252)
MUTED = (148, 163, 184)
STEP = {"azure": "1", "aws": "1", "advisor": "2", "iac": "3"}
TITLE = {
    "azure": "Prompt to diagram (Azure)",
    "aws": "Prompt to diagram (AWS)",
    "advisor": "Ask the Microsoft Learn-grounded advisor",
    "iac": "Diagram to infrastructure as code",
}


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _caption(scene: str, caption: str) -> Image.Image:
    strip = Image.new("RGB", (WIDTH, CAPTION_H), BG)
    draw = ImageDraw.Draw(strip)
    step = STEP.get(scene, "")
    x = 16
    if step:
        draw.rounded_rectangle((x, 11, x + 24, 35), radius=12, fill=ACCENT)
        draw.text((x + 12, 23), step, font=_font(15, bold=True), fill=TEXT, anchor="mm")
        x += 36
    title = TITLE.get(scene, "")
    draw.text((x, 23), title, font=_font(17, bold=True), fill=TEXT, anchor="lm")
    x += int(draw.textlength(title, font=_font(17, bold=True))) + 14
    detail = caption.split(" - ", 1)[1] if " - " in caption else ""
    if detail:
        draw.text((x, 23), detail, font=_font(15), fill=MUTED, anchor="lm")
    return strip


def build(frames_dir: Path, out: Path) -> None:
    manifest = json.loads((frames_dir / "manifest.json").read_text(encoding="utf-8"))
    rgb_frames, durations = [], []
    for item in manifest["frames"]:
        shot = Image.open(frames_dir / item["file"]).convert("RGB")
        height = round(shot.height * WIDTH / shot.width)
        shot = shot.resize((WIDTH, height), Image.LANCZOS)
        canvas = Image.new("RGB", (WIDTH, CAPTION_H + height), BG)
        canvas.paste(_caption(item["scene"], item["caption"]), (0, 0))
        canvas.paste(shot, (0, CAPTION_H))
        rgb_frames.append(canvas)
        durations.append(int(item["hold_ms"]))

    # One shared palette built from a strip of every frame.
    sample_w = WIDTH // 4
    sample_h = rgb_frames[0].height // 4
    montage = Image.new("RGB", (sample_w, sample_h * len(rgb_frames)))
    for i, f in enumerate(rgb_frames):
        montage.paste(f.resize((sample_w, sample_h)), (0, i * sample_h))
    palette = montage.quantize(colors=128, method=Image.Quantize.MEDIANCUT)

    frames = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in rgb_frames]
    out.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True, disposal=1)
    print(f"Wrote {out} ({out.stat().st_size / 1024 / 1024:.2f} MB, {len(frames)} frames, {sum(durations) / 1000:.1f}s)")


if __name__ == "__main__":
    frames_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.gettempdir()) / "liftoff-demo-frames"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[2] / "docs" / "images" / "demo.gif"
    build(frames_dir, out)
