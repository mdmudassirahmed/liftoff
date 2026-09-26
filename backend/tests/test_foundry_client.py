"""IaC generation plumbing with a fake agent (no Azure calls)."""
import asyncio
import json

import pytest

from app.agents.foundry import foundry_client as fc


@pytest.fixture()
def fake_client(monkeypatch):
    client = fc.FoundryClient()
    monkeypatch.setattr(client, "_initialized", True)
    prompts = []

    def make(reply):
        async def fake_chat(agent_type, message, context=None):
            prompts.append(message)
            return fc.AgentResponse(content=reply, agent_name="iac-generator-agent", agent_type=agent_type)

        monkeypatch.setattr(client, "chat", fake_chat)
        return client

    async def no_validate(files):  # never shell out to `az bicep build` in tests
        return []

    monkeypatch.setattr(fc, "_validate_bicep_files", no_validate)
    return make, prompts


def test_single_file_generation_regression(fake_client, sample_architecture):
    """The single-file prompt used to raise NameError (unescaped braces in an f-string)."""
    make, prompts = fake_client
    code = (
        "param foo string? = 'x'\n"
        "resource x 'Microsoft.Insights/components@2020-02-02' = { properties: { application_Type: 'web' } }"
    )
    result = asyncio.run(make(json.dumps({"code": code})).generate_iac(sample_architecture, "bicep"))
    assert "application_Type" not in result.content and "Application_Type" in result.content
    assert "string?" not in result.content
    prompt = prompts[0]
    assert "'${kind}'" in prompt and "{ enableHttpsTrafficOnly: true }" in prompt
    assert "SECURITY GUARDRAILS" in prompt
    assert "NETWORKING POLICY" not in prompt  # landing-zone mode is off by default


def test_modular_generation_strips_emoji_and_fences(fake_client, sample_architecture):
    make, prompts = fake_client
    files = {"files": [
        {"path": "main.bicep", "content": "param a string? = ''"},
        {"path": "README.md", "content": "## \U0001F680  Deploy"},
    ], "structure_summary": "2 files"}
    reply = "```json\n" + json.dumps(files) + "\n```"
    result = asyncio.run(make(reply).generate_iac_modular(sample_architecture, "bicep"))
    by_path = {f["path"]: f["content"] for f in result["files"]}
    assert by_path["main.bicep"] == "param a string = ''"
    assert by_path["README.md"] == "## Deploy"
    assert "ManagedBy: 'liftoff'" in prompts[0]


def test_chat_raises_clear_error_when_not_configured(monkeypatch):
    client = fc.FoundryClient()
    monkeypatch.setattr(client, "_initialized", False)
    monkeypatch.setattr(client, "_openai_client", None)
    with pytest.raises(fc.AgentsUnavailableError, match="AZURE_AI_PROJECT_ENDPOINT"):
        asyncio.run(client.chat("iac_generator", "hi"))


@pytest.mark.parametrize("bad, good", [
    ("param location string @description('Region')", "@description('Region')\nparam location string"),
    ("param n string?", "param n string"),
])
def test_bicep_syntax_fixer(bad, good):
    assert fc._fix_bicep_syntax(bad) == good
