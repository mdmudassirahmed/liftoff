"""
Azure AI Foundry Agents Package.

Simple client to call published Azure AI Foundry agents.
Agents are created/managed in the Foundry portal - this just calls them.

Published Agents:
- orchestrator-agent: Central coordinator
- iac-generator-agent: Generate Bicep/Terraform templates
- azure-docs-agent: Search Microsoft Learn documentation
- security-advisor-agent: Security analysis
- validation-agent: IaC validation

Usage:
    from app.agents.foundry import AgentRegistry, AgentType
    
    # Initialize
    await AgentRegistry.initialize()
    
    # Chat with an agent
    response = await AgentRegistry.chat("iac_generator", "Generate Bicep for VNet")
    
    # Generate IaC
    response = await AgentRegistry.generate_iac(architecture_dict, "bicep")
"""

from app.agents.foundry.foundry_client import (
    FoundryClient,
    AgentResponse,
    get_foundry_client,
    shutdown_foundry_client,
    AGENT_NAMES,
)
from app.agents.foundry.registry import AgentRegistry, AgentType


__all__ = [
    # Client
    "FoundryClient",
    "AgentResponse",
    "get_foundry_client",
    "shutdown_foundry_client",
    "AGENT_NAMES",
    # Registry
    "AgentRegistry",
    "AgentType",
]
