"""API router aggregating all endpoints."""
from fastapi import APIRouter
from app.api.endpoints import chat, iac, health, agents, deploy

api_router = APIRouter()

api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(iac.router, prefix="/iac", tags=["iac"])
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(agents.router, prefix="/agents", tags=["agents"])
api_router.include_router(deploy.router, prefix="/deploy", tags=["deploy"])

