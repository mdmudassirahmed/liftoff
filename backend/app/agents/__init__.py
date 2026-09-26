"""AI Agents for Azure architecture assistance."""

# Re-export from foundry subpackage
from app.agents.foundry import (
    AgentRegistry,
    AgentType,
    AgentResponse,
    get_foundry_client,
    shutdown_foundry_client,
)

__all__ = [
    "AgentRegistry",
    "AgentType",
    "AgentResponse",
    "get_foundry_client",
    "shutdown_foundry_client",
]
