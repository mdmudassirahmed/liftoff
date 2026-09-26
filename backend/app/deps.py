"""
MCP Tool Dependencies.
Provides MCP-enhanced Azure documentation search tools for the agent.
"""
from typing import Optional
from app.core.logging import get_logger
from app.mcp.azure_docs_tool import AzureDocsTool, get_azure_docs_tool

logger = get_logger(__name__)

# MCP is now available through our custom Azure docs tool
MCP_AVAILABLE = True

# Singleton instance
_azure_docs_tool: Optional[AzureDocsTool] = None


async def get_mcp_docs_tool() -> Optional[AzureDocsTool]:
    """Get Azure documentation MCP tool singleton."""
    global _azure_docs_tool
    if _azure_docs_tool is None:
        _azure_docs_tool = await get_azure_docs_tool()
        logger.info("Azure docs MCP tool initialized")
    return _azure_docs_tool


async def get_mcp_bicep_tool() -> Optional[AzureDocsTool]:
    """Get Azure Bicep MCP tool - routes to docs tool with Bicep scope."""
    # Reuse the docs tool for Bicep-related queries
    return await get_mcp_docs_tool()


async def get_mcp_terraform_tool() -> Optional[AzureDocsTool]:
    """Get Terraform MCP tool - routes to docs tool with Terraform scope."""
    # Reuse the docs tool for Terraform-related queries
    return await get_mcp_docs_tool()


async def get_microsoft_docs_mcp_tool() -> Optional[AzureDocsTool]:
    """Get Microsoft Docs MCP tool singleton for chat."""
    return await get_mcp_docs_tool()


async def check_mcp_availability() -> dict:
    """Check MCP availability status."""
    tool = await get_mcp_docs_tool()
    return {
        "mcp_available": tool is not None,
        "docs": tool is not None,
        "bicep": tool is not None,
        "terraform": tool is not None
    }


async def cleanup_mcp_tools():
    """Cleanup MCP tool connections on shutdown."""
    global _azure_docs_tool
    if _azure_docs_tool:
        try:
            await _azure_docs_tool.close()
            logger.info("MCP Azure docs tool closed")
        except Exception as e:
            logger.warning(f"Error closing MCP tool | error={str(e)}")
        _azure_docs_tool = None


# Backward compatibility alias
async def cleanup_http_client():
    """Alias for cleanup_mcp_tools."""
    await cleanup_mcp_tools()
