"""Microsoft Learn MCP client and chat grounding, against a fake MCP server."""
import asyncio
import json

import httpx
import pytest

from app.agents.foundry import foundry_client as fc
from app.mcp import learn_mcp

SEARCH_TEXT = json.dumps([
    {"title": "Zone-redundant App Service", "contentUrl": "https://learn.microsoft.com/azure/app-service/zone-redundancy",
     "content": "Enable zone redundancy on Premium v3 plans with at least three instances."},
    {"title": "Azure SQL availability", "contentUrl": "https://learn.microsoft.com/azure/azure-sql/high-availability",
     "content": "Zone-redundant configuration for General Purpose and Business Critical tiers."},
])


def fake_mcp_server(requests: list, sse: bool = False):
    """An httpx transport implementing initialize / initialized / tools/call."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append({"method": body.get("method"), "session": request.headers.get("mcp-session-id"),
                         "accept": request.headers.get("accept")})
        if body.get("method") == "initialize":
            return httpx.Response(200, headers={"mcp-session-id": "s-123"},
                                  json={"jsonrpc": "2.0", "id": body["id"], "result": {"protocolVersion": "2025-03-26"}})
        if body.get("method") == "notifications/initialized":
            return httpx.Response(202)
        if body.get("method") == "tools/call":
            assert body["params"]["name"] == "microsoft_docs_search"
            message = {"jsonrpc": "2.0", "id": body["id"],
                       "result": {"content": [{"type": "text", "text": SEARCH_TEXT}]}}
            if sse:
                return httpx.Response(200, headers={"content-type": "text/event-stream"},
                                      text=f"event: message\ndata: {json.dumps(message)}\n\n")
            return httpx.Response(200, json=message)
        return httpx.Response(400)

    return httpx.MockTransport(handler)


@pytest.fixture()
def patch_transport(monkeypatch):
    def install(transport):
        real = httpx.AsyncClient

        def factory(*args, **kwargs):
            kwargs["transport"] = transport
            return real(*args, **kwargs)

        monkeypatch.setattr(learn_mcp.httpx, "AsyncClient", factory)

    return install


@pytest.mark.parametrize("sse", [False, True])
def test_search_speaks_mcp(patch_transport, sse):
    requests = []
    patch_transport(fake_mcp_server(requests, sse=sse))
    results = asyncio.run(learn_mcp.LearnMCPClient(url="https://learn.test/api/mcp").search("zone redundancy"))
    assert [r.url for r in results] == [
        "https://learn.microsoft.com/azure/app-service/zone-redundancy",
        "https://learn.microsoft.com/azure/azure-sql/high-availability",
    ]
    assert [r["method"] for r in requests] == ["initialize", "notifications/initialized", "tools/call"]
    assert requests[2]["session"] == "s-123"  # session header carried after initialize
    assert "text/event-stream" in requests[0]["accept"]


def test_search_is_fail_safe(patch_transport):
    patch_transport(httpx.MockTransport(lambda r: httpx.Response(503)))
    assert asyncio.run(learn_mcp.LearnMCPClient(url="https://learn.test/api/mcp").search("anything")) == []


def test_parse_search_result_falls_back_to_urls():
    result = {"content": [{"type": "text", "text": "See https://learn.microsoft.com/azure/aks/ for AKS."}]}
    assert [r.url for r in learn_mcp.parse_search_result(result)] == ["https://learn.microsoft.com/azure/aks/"]


def test_grounding_query_extracts_the_question():
    long = "Current Architecture:\n" + "x" * 800 + "\n\nUser Question: How do I make this zone-redundant?"
    assert fc._grounding_query(long) == "How do I make this zone-redundant?"
    assert fc._grounding_query("short question") == "short question"


def _fresh_client(monkeypatch, provider):
    monkeypatch.setattr(fc, "resolve_provider_kind", lambda: "openai")
    monkeypatch.setattr(fc, "build_provider", lambda: provider)
    client = fc.FoundryClient()
    monkeypatch.setattr(client, "_initialized", False)
    monkeypatch.setattr(client, "_provider", None)
    monkeypatch.setattr(client, "_agents_cache", {})
    return client


class RecordingProvider:
    name, model = "openai", "gpt-test"

    def __init__(self):
        self.user = None

    async def complete(self, system, user):
        self.user = user
        return "Use zone-redundant plans [1]."


def test_docs_answers_are_grounded_with_sources(monkeypatch, patch_transport):
    patch_transport(fake_mcp_server([]))
    monkeypatch.setattr(learn_mcp, "_client", learn_mcp.LearnMCPClient(url="https://learn.test/api/mcp"))
    provider = RecordingProvider()
    client = _fresh_client(monkeypatch, provider)
    arch = {"nodes": [{"data": {"resourceType": "Microsoft.Web/sites"}}]}

    reply = asyncio.run(client.chat("azure_docs", "How do I make this zone-redundant?", {"architecture": arch}))
    assert reply.grounding == "microsoft-learn-mcp"
    assert reply.sources[0] == "https://learn.microsoft.com/azure/app-service/zone-redundancy"
    assert provider.user.startswith("MICROSOFT LEARN SEARCH RESULTS")
    assert "Microsoft.Web/sites" in provider.user  # the diagram is still in the prompt


def test_aws_diagrams_are_not_grounded_in_microsoft_learn(monkeypatch, patch_transport):
    requests = []
    patch_transport(fake_mcp_server(requests))
    monkeypatch.setattr(learn_mcp, "_client", learn_mcp.LearnMCPClient(url="https://learn.test/api/mcp"))
    client = _fresh_client(monkeypatch, RecordingProvider())
    arch = {"nodes": [{"data": {"resourceType": "AWS::S3::Bucket"}}]}

    reply = asyncio.run(client.chat("azure_docs", "Is my bucket public?", {"architecture": arch}))
    assert reply.grounding is None and not reply.sources
    assert requests == []
