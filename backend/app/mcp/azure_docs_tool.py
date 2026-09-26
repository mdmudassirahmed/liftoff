"""
Azure Documentation MCP Tool.
Provides real-time Azure documentation search capability for the agent.
Uses Microsoft Learn search API to fetch current Azure best practices.
"""
import httpx
from typing import Optional, Dict, Any
from app.core.logging import get_logger

logger = get_logger(__name__)

# Microsoft Learn search endpoint (public API)
LEARN_SEARCH_URL = "https://docs.microsoft.com/api/search"


class AzureDocsTool:
    """
    Tool for searching Microsoft Azure documentation.
    Returns relevant documentation snippets for Azure architecture questions.
    """
    
    def __init__(self):
        self.name = "search_azure_docs"
        self.description = (
            "Search Microsoft Learn for Azure documentation. "
            "Use this to find current best practices, architecture guidance, "
            "security recommendations, and service configurations."
        )
        self.client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self.client is None:
            self.client = httpx.AsyncClient(
                timeout=httpx.Timeout(30.0),
                headers={
                    "User-Agent": "AzureArchitectAgent/1.0",
                    "Accept": "application/json"
                }
            )
        return self.client
    
    async def search(
        self,
        query: str,
        scope: str = "azure",
        locale: str = "en-us",
        top: int = 5
    ) -> Dict[str, Any]:
        """
        Search Microsoft Learn for Azure documentation.
        
        Args:
            query: Search query (e.g., "VNet security best practices")
            scope: Documentation scope (default: "azure")
            locale: Language locale (default: "en-us")
            top: Number of results to return (default: 5)
        
        Returns:
            Dictionary with search results including titles, URLs, and snippets
        """
        logger.info(f"Searching Azure docs | query='{query}' | scope={scope} | top={top}")
        
        try:
            client = await self._get_client()
            
            # Build search parameters for Microsoft Docs API
            params = {
                "search": f"{query} {scope}",
                "locale": locale,
                "$top": str(top),
                "scope": scope
            }
            
            response = await client.get(LEARN_SEARCH_URL, params=params)
            
            if response.status_code == 200:
                data = response.json()
                results = data.get("results", [])
                
                # Format results for LLM consumption
                formatted_results = []
                for item in results[:top]:
                    formatted_results.append({
                        "title": item.get("title", ""),
                        "url": item.get("url", ""),
                        "description": item.get("description", ""),
                        "lastUpdated": item.get("lastModifiedDateTime", "")
                    })
                
                logger.info(f"Azure docs search completed | results_count={len(formatted_results)}")
                
                return {
                    "query": query,
                    "results_count": len(formatted_results),
                    "results": formatted_results
                }
            else:
                logger.warning(f"Azure docs search HTTP error | status={response.status_code}")
                return await self._fallback_search(query)
                
        except Exception as e:
            logger.warning(f"Azure docs search failed | error={str(e)}")
            return await self._fallback_search(query)
    
    async def _fallback_search(self, query: str) -> Dict[str, Any]:
        """
        Fallback when Learn API is unavailable.
        Returns curated Azure documentation links.
        """
        # Map common topics to known documentation
        topic_docs = {
            "vnet": [
                {"title": "Azure Virtual Network documentation", 
                 "url": "https://learn.microsoft.com/azure/virtual-network/",
                 "description": "Learn about Azure Virtual Network concepts and best practices."},
                {"title": "Network security best practices",
                 "url": "https://learn.microsoft.com/azure/security/fundamentals/network-best-practices",
                 "description": "Azure network security best practices guide."}
            ],
            "security": [
                {"title": "Azure security fundamentals",
                 "url": "https://learn.microsoft.com/azure/security/fundamentals/",
                 "description": "Azure security fundamentals documentation."},
                {"title": "Azure Well-Architected Framework - Security",
                 "url": "https://learn.microsoft.com/azure/well-architected/security/",
                 "description": "Security pillar of the Azure Well-Architected Framework."}
            ],
            "app service": [
                {"title": "App Service documentation",
                 "url": "https://learn.microsoft.com/azure/app-service/",
                 "description": "Azure App Service documentation and tutorials."}
            ],
            "kubernetes": [
                {"title": "Azure Kubernetes Service documentation",
                 "url": "https://learn.microsoft.com/azure/aks/",
                 "description": "Azure Kubernetes Service (AKS) documentation."}
            ],
            "storage": [
                {"title": "Azure Storage documentation",
                 "url": "https://learn.microsoft.com/azure/storage/",
                 "description": "Azure Storage services documentation."}
            ]
        }
        
        # Find matching topics
        query_lower = query.lower()
        results = []
        
        for topic, docs in topic_docs.items():
            if topic in query_lower:
                results.extend(docs)
        
        # Add general Well-Architected Framework
        if not results:
            results = [
                {"title": "Azure Well-Architected Framework",
                 "url": "https://learn.microsoft.com/azure/well-architected/",
                 "description": "Best practices for building reliable, secure, efficient Azure solutions."}
            ]
        
        return {
            "query": query,
            "results_count": len(results),
            "results": results,
            "fallback": True
        }
    
    def get_tool_definition(self) -> Dict[str, Any]:
        """
        Get OpenAI function/tool definition for this tool.
        This format is used by OpenAI's function calling.
        """
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query for Azure documentation (e.g., 'VNet security best practices')"
                        },
                        "scope": {
                            "type": "string",
                            "enum": ["azure", "azure-devops", "microsoft-365"],
                            "default": "azure",
                            "description": "Documentation scope to search"
                        }
                    },
                    "required": ["query"]
                }
            }
        }
    
    async def close(self):
        """Close HTTP client."""
        if self.client:
            await self.client.aclose()
            self.client = None


# Singleton instance
_azure_docs_tool: Optional[AzureDocsTool] = None


async def get_azure_docs_tool() -> AzureDocsTool:
    """Get singleton Azure docs tool instance."""
    global _azure_docs_tool
    if _azure_docs_tool is None:
        _azure_docs_tool = AzureDocsTool()
    return _azure_docs_tool
