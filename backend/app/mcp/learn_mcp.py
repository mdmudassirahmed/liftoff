"""
Microsoft Learn MCP client.

Talks to the public Microsoft Learn MCP server (https://learn.microsoft.com/api/mcp)
over the MCP Streamable HTTP transport (JSON-RPC 2.0) and calls its
`microsoft_docs_search` tool. Used to ground the architecture advisor's answers
about Azure diagrams in current official documentation, for every AI provider.

Fail-safe: any network or protocol error returns an empty result list, so the
advisor still answers (ungrounded) instead of failing.
"""
from __future__ import annotations

import itertools
import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

PROTOCOL_VERSION = "2025-03-26"
SEARCH_TOOL = "microsoft_docs_search"
_URL_RE = re.compile(r"https://learn\.microsoft\.com/[^\s)\]\"'>]+")


@dataclass
class LearnResult:
    title: str
    url: str
    excerpt: str


def _parse_body(response: httpx.Response) -> Optional[Dict[str, Any]]:
    """Return the JSON-RPC message from a JSON or text/event-stream response."""
    ctype = response.headers.get("content-type", "")
    text = response.text
    if "text/event-stream" in ctype:
        message = None
        for line in text.splitlines():
            if line.startswith("data:"):
                data = line[5:].strip()
                if data:
                    try:
                        candidate = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(candidate, dict) and ("result" in candidate or "error" in candidate):
                        message = candidate
        return message
    if not text.strip():
        return None
    try:
        return response.json()
    except json.JSONDecodeError:
        return None


def parse_search_result(result: Dict[str, Any], limit: int = 5) -> List[LearnResult]:
    """Turn a tools/call result into LearnResults.

    The Learn server returns text content whose text is usually a JSON list of
    {title, content, contentUrl}; plain text with URLs is handled as a fallback.
    """
    out: List[LearnResult] = []
    for item in (result or {}).get("content", []) or []:
        if not isinstance(item, dict) or item.get("type") != "text":
            continue
        text = item.get("text", "")
        parsed: Any = None
        try:
            parsed = json.loads(text)
        except (json.JSONDecodeError, TypeError):
            parsed = None
        if isinstance(parsed, dict):
            parsed = parsed.get("results") or parsed.get("items") or [parsed]
        if isinstance(parsed, list):
            for entry in parsed:
                if not isinstance(entry, dict):
                    continue
                url = entry.get("contentUrl") or entry.get("url") or entry.get("link") or ""
                title = entry.get("title") or url
                excerpt = entry.get("content") or entry.get("snippet") or entry.get("description") or ""
                if url:
                    out.append(LearnResult(title=str(title).strip(), url=str(url).strip(), excerpt=str(excerpt).strip()))
        else:
            for url in dict.fromkeys(_URL_RE.findall(text)):
                out.append(LearnResult(title=url, url=url, excerpt=""))
    # De-duplicate by URL, keep order.
    seen, unique = set(), []
    for r in out:
        if r.url not in seen:
            seen.add(r.url)
            unique.append(r)
    return unique[:limit]


class LearnMCPClient:
    """Minimal MCP client for the Microsoft Learn server."""

    def __init__(self, url: Optional[str] = None, timeout: float = 20.0) -> None:
        self.url = url or get_settings().MCP_MICROSOFT_DOCS_URL
        self.timeout = timeout
        self._session_id: Optional[str] = None
        self._initialized = False
        self._ids = itertools.count(1)

    def _headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
        }
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
        return headers

    async def _post(self, client: httpx.AsyncClient, payload: Dict[str, Any]) -> httpx.Response:
        return await client.post(self.url, json=payload, headers=self._headers())

    async def _initialize(self, client: httpx.AsyncClient) -> None:
        from app import __version__

        response = await self._post(client, {
            "jsonrpc": "2.0",
            "id": next(self._ids),
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "liftoff", "version": __version__},
            },
        })
        response.raise_for_status()
        self._session_id = response.headers.get("mcp-session-id") or self._session_id
        await self._post(client, {"jsonrpc": "2.0", "method": "notifications/initialized"})
        self._initialized = True

    async def search(self, query: str, limit: int = 5) -> List[LearnResult]:
        """Search Microsoft Learn. Returns [] on any failure."""
        query = (query or "").strip()
        if not query:
            return []
        try:
            async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
                for attempt in range(2):
                    if not self._initialized:
                        await self._initialize(client)
                    response = await self._post(client, {
                        "jsonrpc": "2.0",
                        "id": next(self._ids),
                        "method": "tools/call",
                        "params": {"name": SEARCH_TOOL, "arguments": {"query": query[:500]}},
                    })
                    if response.status_code in (400, 404) and attempt == 0:
                        # Session expired or unknown: start a new one and retry once.
                        self._initialized, self._session_id = False, None
                        continue
                    response.raise_for_status()
                    message = _parse_body(response) or {}
                    if "error" in message:
                        logger.warning(f"Learn MCP tool error: {message['error']}")
                        return []
                    results = parse_search_result(message.get("result") or {}, limit=limit)
                    logger.info(f"Learn MCP search | results={len(results)}")
                    return results
        except Exception as e:  # noqa: BLE001 - grounding is best-effort
            logger.warning(f"Learn MCP search failed: {e}")
            self._initialized, self._session_id = False, None
        return []


_client: Optional[LearnMCPClient] = None


def get_learn_client() -> LearnMCPClient:
    global _client
    if _client is None:
        _client = LearnMCPClient()
    return _client


def format_grounding(results: List[LearnResult], max_excerpt: int = 700) -> str:
    """Render search results as a prompt block the model can cite."""
    lines = [
        "MICROSOFT LEARN SEARCH RESULTS (retrieved just now via the Microsoft Learn MCP server).",
        "Base your answer on these where relevant and cite the URLs you used:",
    ]
    for i, r in enumerate(results, 1):
        excerpt = re.sub(r"\s+", " ", r.excerpt)[:max_excerpt]
        lines.append(f"[{i}] {r.title}\n    {r.url}\n    {excerpt}")
    return "\n".join(lines)
