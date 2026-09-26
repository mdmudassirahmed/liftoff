"""Health check endpoints."""
from fastapi import APIRouter

from app import __version__
from app.core.config import get_settings
from app.deps import check_mcp_availability
from app.agents.foundry import AgentRegistry
from app.agents.providers import resolve_provider_kind
import logging

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()


@router.get("")
async def health_check():
    """Basic health check endpoint."""
    return {
        "status": "healthy",
        "service": "liftoff-backend",
        "version": __version__
    }


@router.get("/ready")
async def readiness_check():
    """
    Readiness check that verifies all dependencies.
    """
    checks = {
        "api": True,
        "ai_configured": resolve_provider_kind() != "none",
        "ai_provider": resolve_provider_kind(),
    }
    
    # Check MCP availability
    mcp_status = await check_mcp_availability()
    checks["mcp_docs"] = mcp_status.get("docs", False)
    checks["mcp_bicep"] = mcp_status.get("bicep", False)
    checks["mcp_terraform"] = mcp_status.get("terraform", False)
    
    # Check agent registry
    try:
        agents = AgentRegistry.list_agents()
        checks["agents_discovered"] = len(agents) > 0
        checks["agents_count"] = len(agents)
    except Exception:
        checks["agents_discovered"] = False
        checks["agents_count"] = 0
    
    all_critical_healthy = checks["api"] and checks["ai_foundry_configured"]
    
    return {
        "ready": all_critical_healthy,
        "checks": checks
    }


@router.get("/agents")
async def agents_health():
    """
    Agent health check.
    Shows which agents are available.
    """
    try:
        agents = AgentRegistry.list_agents()
        return {
            "status": "healthy" if agents else "no_agents",
            "agents": agents,
            "count": len(agents)
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }


@router.get("/live")
async def liveness_check():
    """Simple liveness probe."""
    return {"alive": True}
