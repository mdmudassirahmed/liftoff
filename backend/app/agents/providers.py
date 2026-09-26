"""
Chat model providers.

Liftoff's five agents are system prompts (app/agents/prompts.py). Any chat model
can run them. Pick a provider in backend/.env:

    AI_PROVIDER=auto | openai | azure-openai | foundry | none

With `auto` (the default) the first configured option wins, in this order:
    1. AZURE_AI_PROJECT_ENDPOINT  -> Azure AI Foundry agents (handled by foundry_client)
    2. AZURE_OPENAI_ENDPOINT      -> Azure OpenAI (keyless via az login, or AZURE_OPENAI_API_KEY)
    3. OPENAI_API_KEY / OPENAI_BASE_URL -> OpenAI, or any OpenAI-compatible server
                                     (Ollama, LM Studio, vLLM, OpenRouter, ...)
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Optional, Protocol

from app.core.config import Settings, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

FOUNDRY = "foundry"
AZURE_OPENAI = "azure-openai"
OPENAI = "openai"
NONE = "none"


def resolve_provider_kind(settings: Optional[Settings] = None) -> str:
    """Which provider the current settings select (without connecting)."""
    s = settings or get_settings()
    choice = (s.AI_PROVIDER or "auto").strip().lower()
    if choice in (FOUNDRY, AZURE_OPENAI, OPENAI, NONE):
        return choice
    if s.AZURE_AI_PROJECT_ENDPOINT:
        return FOUNDRY
    if s.AZURE_OPENAI_ENDPOINT:
        return AZURE_OPENAI
    if s.OPENAI_API_KEY or s.OPENAI_BASE_URL:
        return OPENAI
    return NONE


def not_configured_message() -> str:
    return (
        "AI features are not configured. In backend/.env set one of: OPENAI_API_KEY "
        "(OpenAI or any OpenAI-compatible server via OPENAI_BASE_URL), "
        "AZURE_OPENAI_ENDPOINT, or AZURE_AI_PROJECT_ENDPOINT. See README: Enabling the AI features."
    )


class ChatProvider(Protocol):
    name: str
    model: str

    async def complete(self, system: str, user: str) -> str: ...


@dataclass
class OpenAICompatibleProvider:
    """OpenAI, or any server that speaks the OpenAI chat-completions API."""

    name: str
    model: str
    api_key: str
    base_url: Optional[str] = None

    def __post_init__(self) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=self.api_key or "not-needed", base_url=self.base_url or None)

    async def complete(self, system: str, user: str) -> str:
        return await _chat_completion(self._client, self.model, system, user)


@dataclass
class AzureOpenAIProvider:
    """Azure OpenAI deployment. Keyless (az login / managed identity) unless a key is set."""

    name: str
    model: str
    endpoint: str
    api_version: str
    api_key: str = ""

    def __post_init__(self) -> None:
        from openai import AzureOpenAI

        if self.api_key:
            self._client = AzureOpenAI(azure_endpoint=self.endpoint, api_key=self.api_key, api_version=self.api_version)
        else:
            from azure.identity import DefaultAzureCredential, get_bearer_token_provider

            token_provider = get_bearer_token_provider(
                DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
            )
            self._client = AzureOpenAI(
                azure_endpoint=self.endpoint, azure_ad_token_provider=token_provider, api_version=self.api_version
            )

    async def complete(self, system: str, user: str) -> str:
        return await _chat_completion(self._client, self.model, system, user)


async def _chat_completion(client, model: str, system: str, user: str) -> str:
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(
        None,
        lambda: client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        ),
    )
    return (response.choices[0].message.content or "") if response.choices else ""


def build_provider(settings: Optional[Settings] = None) -> Optional[ChatProvider]:
    """Create the chat provider for the current settings.

    Returns None for `none` and for `foundry` (Foundry agents are driven by
    foundry_client, which owns the agent lifecycle and the Responses API).
    """
    s = settings or get_settings()
    kind = resolve_provider_kind(s)
    if kind == AZURE_OPENAI:
        if not s.AZURE_OPENAI_ENDPOINT:
            raise AgentsConfigError("AI_PROVIDER=azure-openai needs AZURE_OPENAI_ENDPOINT.")
        model = s.AZURE_OPENAI_DEPLOYMENT or s.AI_MODEL
        logger.info(f"AI provider: Azure OpenAI | deployment={model} | auth={'key' if s.AZURE_OPENAI_API_KEY else 'entra'}")
        return AzureOpenAIProvider(
            name="azure-openai",
            model=model,
            endpoint=s.AZURE_OPENAI_ENDPOINT,
            api_version=s.AZURE_OPENAI_API_VERSION,
            api_key=s.AZURE_OPENAI_API_KEY,
        )
    if kind == OPENAI:
        if not (s.OPENAI_API_KEY or s.OPENAI_BASE_URL):
            raise AgentsConfigError("AI_PROVIDER=openai needs OPENAI_API_KEY (or OPENAI_BASE_URL for a local server).")
        logger.info(f"AI provider: OpenAI-compatible | model={s.AI_MODEL} | base_url={s.OPENAI_BASE_URL or 'api.openai.com'}")
        return OpenAICompatibleProvider(name="openai", model=s.AI_MODEL, api_key=s.OPENAI_API_KEY, base_url=s.OPENAI_BASE_URL)
    return None


class AgentsConfigError(RuntimeError):
    """A provider was selected explicitly but its settings are incomplete."""
