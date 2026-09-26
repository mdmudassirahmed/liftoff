"""Shared error mapping for API endpoints."""
from fastapi import HTTPException

from app.agents.foundry.foundry_client import AgentsUnavailableError


def to_http_error(exc: Exception) -> HTTPException:
    """Map an exception to an HTTPException.

    AI features that are not configured return 503 with an actionable message;
    anything else is a 500.
    """
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, AgentsUnavailableError):
        return HTTPException(status_code=503, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))
