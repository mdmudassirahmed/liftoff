"""Application configuration using pydantic-settings.

Every value can be overridden with an environment variable or backend/.env.
Nothing secret has a default: AI features stay off until you point the backend
at your own Azure AI Foundry project.
"""
from functools import lru_cache
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # Azure AI Foundry project that hosts the agents (created by agents/create_agents.py).
    # Authentication is keyless: DefaultAzureCredential (az login, managed identity, ...).
    AZURE_AI_PROJECT_ENDPOINT: str = ""

    # Public MCP servers used for grounding (no auth required).
    MCP_BICEP_URL: str = "https://learn.microsoft.com/api/mcp/tools/azure-bicep-schema"
    MCP_TERRAFORM_URL: str = "https://developer.hashicorp.com/terraform/mcp-server"
    MCP_MICROSOFT_DOCS_URL: str = "https://learn.microsoft.com/api/mcp"

    # Server. Binds to loopback by default: the deploy API acts with YOUR az login,
    # so it must not be reachable from other machines unless you add auth in front.
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # Browser origins allowed to call the API (comma-separated in .env).
    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]

    # Host headers accepted by the API (comma-separated). Blocks DNS-rebinding
    # attacks against the local server. Use "*" only behind an authenticating proxy.
    ALLOWED_HOSTS: Annotated[list[str], NoDecode] = ["localhost", "127.0.0.1", "[::1]", "testserver"]

    # Optional shared secret. When set, every /api request must send
    # "Authorization: Bearer <token>" (the frontend reads VITE_API_TOKEN).
    API_AUTH_TOKEN: str = ""

    # Security guardrails injected into IaC prompts + compliance report.
    GUARDRAILS_ENABLED: bool = True
    # Landing-zone mode: generated IaC references existing VNets/subnets
    # instead of creating them (for estates where a platform team owns networking).
    IAC_REFERENCE_EXISTING_NETWORKS: bool = False

    @field_validator("CORS_ORIGINS", "ALLOWED_HOSTS", mode="before")
    @classmethod
    def _split_csv(cls, value):
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
