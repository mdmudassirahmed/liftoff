"""Azure plugin - Bicep, Terraform and ARM through the agent registry."""
from typing import Any, Dict
from app.csp.base import AbstractCSPPlugin
from app.agents.foundry import AgentRegistry


class AzureCSPPlugin(AbstractCSPPlugin):
    """Delegates to the IaC generator agent on the configured AI provider."""

    @property
    def csp_name(self) -> str:
        return "azure"

    @property
    def default_iac_format(self) -> str:
        return "bicep"

    def get_supported_formats(self) -> list[str]:
        return ["bicep", "terraform", "arm"]

    async def generate_iac(
        self,
        architecture: Dict[str, Any],
        fmt: str,
        modular: bool = False,
    ) -> Dict[str, Any]:
        if modular:
            result = await AgentRegistry.generate_iac_modular(
                architecture=architecture,
                format=fmt,
            )
            return result
        response = await AgentRegistry.generate_iac(
            architecture=architecture,
            format=fmt,
        )
        return {
            "template": response.content,
            "format": fmt,
            "agent_name": response.agent_name,
        }
