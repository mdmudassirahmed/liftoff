"""
Agent Registry.

Simple registry for accessing Azure AI Foundry agents.
All agents are created/managed in Azure AI Foundry portal.
This registry just provides access to call them.
"""
from typing import Dict, Optional, Any, List

from app.agents.foundry.foundry_client import (
    FoundryClient,
    AgentResponse,
    get_foundry_client,
)
from app.core.logging import get_logger

logger = get_logger(__name__)


# Agent type constants for API compatibility
class AgentType:
    """Agent type identifiers."""
    ORCHESTRATOR = "orchestrator"
    IAC_GENERATOR = "iac_generator"
    AZURE_DOCS = "azure_docs"
    SECURITY_ADVISOR = "security_advisor"
    VALIDATION = "validation"


class AgentRegistry:
    """
    Registry for accessing Azure AI Foundry published agents.
    
    Usage:
        # Initialize the registry
        await AgentRegistry.initialize()
        
        # Chat with a specific agent
        response = await AgentRegistry.chat("iac_generator", "Generate Bicep for VNet")
        
        # Generate IaC from architecture
        response = await AgentRegistry.generate_iac(architecture_dict, "bicep")
        
        # Cleanup on shutdown
        await AgentRegistry.cleanup()
    """
    
    _client: Optional[FoundryClient] = None
    _initialized: bool = False
    
    @classmethod
    async def initialize(cls) -> None:
        """Initialize the registry and connect to Foundry."""
        if cls._initialized and cls._client is not None:
            logger.debug("Agent registry already initialized")
            return
        
        logger.info("Initializing agent registry with Foundry client...")
        
        try:
            cls._client = get_foundry_client()
            success = await cls._client.initialize()
            
            if success:
                agents = cls._client.list_agents()
                logger.info(
                    f"Agent registry initialized | "
                    f"agents={list(agents.keys())}"
                )
                cls._initialized = True
            else:
                logger.error("Failed to initialize Foundry client")
                
        except Exception as e:
            logger.error(f"Failed to initialize agent registry: {e}")
            raise
    
    @classmethod
    async def chat(
        cls, 
        agent_type: str, 
        message: str,
        context: Optional[Dict[str, Any]] = None
    ) -> AgentResponse:
        """
        Send a message to a specific agent.
        
        Args:
            agent_type: The type of agent (orchestrator, iac_generator, etc.)
            message: The message to send
            context: Optional context data (e.g., architecture JSON)
            
        Returns:
            AgentResponse with the agent's reply
        """
        if not cls._initialized or cls._client is None:
            await cls.initialize()
        
        return await cls._client.chat(agent_type, message, context)
    
    @classmethod
    async def generate_iac(
        cls,
        architecture: Dict[str, Any],
        format: str = "bicep"
    ) -> AgentResponse:
        """
        Generate IaC templates from architecture.
        
        Args:
            architecture: Architecture diagram as JSON
            format: Output format (bicep or terraform)
            
        Returns:
            AgentResponse with generated IaC code
        """
        if not cls._initialized or cls._client is None:
            await cls.initialize()
        
        return await cls._client.generate_iac(architecture, format)
    
    @classmethod
    async def generate_iac_modular(
        cls,
        architecture: Dict[str, Any],
        format: str = "bicep"
    ) -> Dict[str, Any]:
        """
        Generate modular IaC templates from architecture.
        
        Creates a production-ready folder structure with:
        - main.bicep: Orchestrator that references modules
        - parameters/: Environment-specific parameter files
        - modules/: Reusable modules organized by category
        - README.md: Deployment instructions
        
        Args:
            architecture: Architecture diagram as JSON
            format: Output format (bicep or terraform)
            
        Returns:
            Dict with files list and metadata
        """
        if not cls._initialized or cls._client is None:
            await cls.initialize()
        
        return await cls._client.generate_iac_modular(architecture, format)
    
    @classmethod
    async def search_docs(cls, query: str) -> AgentResponse:
        """Search Azure documentation."""
        if not cls._initialized or cls._client is None:
            await cls.initialize()
        
        return await cls._client.search_docs(query)
    
    @classmethod
    async def analyze_security(
        cls,
        architecture: Dict[str, Any],
        compliance_frameworks: Optional[List[str]] = None
    ) -> AgentResponse:
        """Analyze architecture security."""
        if not cls._initialized or cls._client is None:
            await cls.initialize()
        
        return await cls._client.analyze_security(architecture, compliance_frameworks)
    
    @classmethod
    async def validate_iac(
        cls,
        template: str,
        template_type: str = "bicep"
    ) -> AgentResponse:
        """Validate IaC template."""
        if not cls._initialized or cls._client is None:
            await cls.initialize()
        
        return await cls._client.validate_iac(template, template_type)
    
    @classmethod
    def list_agents(cls) -> Dict[str, Any]:
        """List available agents."""
        if cls._client:
            return cls._client.list_agents()
        return {}
    
    @classmethod
    def get_agent_info(cls, agent_type: str) -> Optional[Dict[str, Any]]:
        """Get info about a specific agent."""
        if cls._client:
            return cls._client.get_agent_info(agent_type)
        return None
    
    @classmethod
    async def cleanup(cls) -> None:
        """Cleanup resources."""
        logger.info("Cleaning up agent registry...")
        if cls._client:
            await cls._client.cleanup()
        cls._client = None
        cls._initialized = False
        logger.info("Agent registry cleaned up")
