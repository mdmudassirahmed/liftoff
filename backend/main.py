"""
Liftoff backend - FastAPI service.

Turns architecture diagrams into infrastructure-as-code with Azure AI Foundry
agents, checks the output against security guardrails, and previews/deploys it
with the Azure CLI.
"""
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app import __version__
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.core.security import RequestGuardMiddleware
from app.api.routes import api_router
from app.deps import cleanup_mcp_tools
from app.agents.foundry import AgentRegistry
from app.agents.providers import resolve_provider_kind

settings = get_settings()
setup_logging(level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle management for connections and agents."""
    logger.info(f"Starting Liftoff backend v{__version__}")
    if resolve_provider_kind() != "none":
        logger.info("Initializing AI agents...")
        try:
            await AgentRegistry.initialize()
        except Exception as e:  # noqa: BLE001 - AI is optional at startup
            logger.warning(f"Agent initialization deferred: {e}")
    else:
        logger.warning(
            "No AI provider configured - AI features (prompt-to-diagram, IaC generation, "
            "advisor chat) are disabled. Canvas, validation, What-If and deploy still work. "
            "Set OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT or AZURE_AI_PROJECT_ENDPOINT in backend/.env."
        )

    yield

    logger.info("Shutting down, cleaning up connections...")
    await cleanup_mcp_tools()
    try:
        await AgentRegistry.cleanup()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Agent cleanup error: {e}")


app = FastAPI(
    title="Liftoff API",
    description="""
Backend API for Liftoff - design Azure architectures visually, generate IaC with AI, deploy safely.

## Features
- **Prompt to diagram**: describe an architecture in plain English
- **IaC generation**: modular Bicep / Terraform from the diagram
- **Security guardrails**: compliant-by-default templates + compliance report
- **What-If and deploy**: preview and deploy with your Azure CLI identity
- **Architecture advisor**: chat grounded in Microsoft Learn (MCP)
    """,
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Middleware: the last one added runs first. CORS wraps the guard so that
# rejections still carry CORS headers and the browser can show the error.
app.add_middleware(
    RequestGuardMiddleware,
    allowed_origins=settings.CORS_ORIGINS,
    api_token=settings.API_AUTH_TOKEN,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)

app.include_router(api_router, prefix="/api")


@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        "name": "Liftoff API",
        "version": __version__,
        "docs": "/docs",
        "health": "/api/health",
        "ai_configured": resolve_provider_kind() != "none",
        "ai_provider": resolve_provider_kind(),
    }


@app.get("/health")
async def health_check():
    """Quick health check."""
    agents = AgentRegistry.list_agents()
    return {
        "status": "healthy",
        "agents_initialized": AgentRegistry._initialized,
        "agent_count": len(agents),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
