"""The agent definitions are the single source for every provider, including Foundry."""
import subprocess
import sys
from pathlib import Path

from app.agents.foundry.foundry_client import AGENT_NAMES
from app.agents.prompts import AGENTS, SYSTEM_PROMPTS

BACKEND = Path(__file__).resolve().parents[1]


def test_every_agent_has_a_prompt_and_a_unique_name():
    assert set(AGENTS) == set(SYSTEM_PROMPTS)
    assert {"iac_generator", "aws_iac_generator", "azure_docs"} <= set(AGENTS)
    names = [spec["name"] for spec in AGENTS.values()]
    assert len(names) == len(set(names))
    assert AGENT_NAMES == {k: v["name"] for k, v in AGENTS.items()}


def test_foundry_tools_are_known():
    known = {"mcp_microsoft_learn", "code_interpreter"}
    assert all(set(spec["foundry_tools"]) <= known for spec in AGENTS.values())
    assert "mcp_microsoft_learn" in AGENTS["azure_docs"]["foundry_tools"]


def test_foundry_script_dry_run_needs_no_azure():
    out = subprocess.run(
        [sys.executable, "scripts/foundry_agents.py", "create", "--dry-run"],
        cwd=BACKEND, capture_output=True, text=True, check=True,
    ).stdout
    assert all(spec["name"] in out for spec in AGENTS.values())
