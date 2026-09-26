"""Provider selection and the OpenAI-compatible path (no network)."""
import asyncio
import types

import pytest

from app.agents import providers
from app.agents.foundry import foundry_client as fc
from app.agents.prompts import SYSTEM_PROMPTS
from app.core.config import Settings


def _settings(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


def test_prompts_cover_every_agent():
    assert set(SYSTEM_PROMPTS) == set(fc.AGENT_NAMES)
    assert all(len(p) > 200 for p in SYSTEM_PROMPTS.values())


@pytest.mark.parametrize("kw, expected", [
    ({}, "none"),
    ({"OPENAI_API_KEY": "sk-test"}, "openai"),
    ({"OPENAI_BASE_URL": "http://localhost:11434/v1"}, "openai"),
    ({"AZURE_OPENAI_ENDPOINT": "https://x.openai.azure.com/"}, "azure-openai"),
    ({"AZURE_AI_PROJECT_ENDPOINT": "https://x.services.ai.azure.com/api/projects/p"}, "foundry"),
    # Foundry wins in auto mode when several are set; an explicit choice overrides.
    ({"AZURE_AI_PROJECT_ENDPOINT": "https://x", "OPENAI_API_KEY": "sk"}, "foundry"),
    ({"AI_PROVIDER": "openai", "AZURE_AI_PROJECT_ENDPOINT": "https://x", "OPENAI_API_KEY": "sk"}, "openai"),
    ({"AI_PROVIDER": "none", "OPENAI_API_KEY": "sk"}, "none"),
])
def test_provider_selection(kw, expected):
    assert providers.resolve_provider_kind(_settings(**kw)) == expected


def test_explicit_provider_with_missing_settings_is_an_error():
    with pytest.raises(providers.AgentsConfigError):
        providers.build_provider(_settings(AI_PROVIDER="openai"))


def test_openai_compatible_provider_sends_system_prompt(monkeypatch):
    """The agent's system prompt goes in the system message; the request in the user message."""
    calls = []

    class FakeCompletions:
        def create(self, **kwargs):
            calls.append(kwargs)
            msg = types.SimpleNamespace(content='{"code": "param x string"}')
            return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])

    class FakeOpenAI:
        def __init__(self, **kwargs):
            calls.append({"client": kwargs})
            self.chat = types.SimpleNamespace(completions=FakeCompletions())

    import openai
    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)

    provider = providers.OpenAICompatibleProvider(
        name="openai", model="llama3.1", api_key="", base_url="http://localhost:11434/v1"
    )
    out = asyncio.run(provider.complete("SYSTEM", "USER"))
    assert out == '{"code": "param x string"}'
    assert calls[0]["client"]["base_url"] == "http://localhost:11434/v1"
    assert calls[1]["model"] == "llama3.1"
    assert calls[1]["messages"] == [{"role": "system", "content": "SYSTEM"}, {"role": "user", "content": "USER"}]


def test_client_uses_chat_provider_when_configured(monkeypatch):
    """With OPENAI_API_KEY set, agents run on the chat provider without any Foundry client."""
    seen = {}

    class FakeProvider:
        name = "openai"
        model = "gpt-test"

        async def complete(self, system, user):
            seen["system"] = system
            seen["user"] = user
            return "hello from the model"

    monkeypatch.setattr(fc, "resolve_provider_kind", lambda: "openai")
    monkeypatch.setattr(fc, "build_provider", lambda: FakeProvider())

    client = fc.FoundryClient()
    monkeypatch.setattr(client, "_initialized", False)
    monkeypatch.setattr(client, "_provider", None)
    monkeypatch.setattr(client, "_agents_cache", {})

    reply = asyncio.run(client.chat("security_advisor", "Is my storage account public?"))
    assert reply.content == "hello from the model"
    assert reply.agent_name == "security-advisor-agent"
    assert seen["system"] == SYSTEM_PROMPTS["security_advisor"]
    assert "storage account" in seen["user"]
    assert client.list_agents()["security_advisor"]["provider"] == "openai"

    # Leave the singleton clean for other tests.
    monkeypatch.setattr(client, "_initialized", False)
    monkeypatch.setattr(client, "_provider", None)
    monkeypatch.setattr(client, "_agents_cache", {})
