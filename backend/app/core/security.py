"""Request-level security for the API.

The backend runs Azure CLI commands as the signed-in user, so a request that
reaches it can create or change cloud resources. Three layers keep it safe:

1. Host allow-list (TrustedHostMiddleware in main.py) - defeats DNS rebinding,
   where a malicious page resolves its own hostname to 127.0.0.1.
2. Origin check (this module) - a state-changing request that carries a
   browser Origin header must come from an allowed origin. This stops a
   website you happen to visit from POSTing to http://localhost:8000.
3. Optional bearer token (this module) - set API_AUTH_TOKEN to require
   "Authorization: Bearer <token>" on every /api call, e.g. when the API is
   exposed beyond localhost behind a reverse proxy.
"""
from __future__ import annotations

import hmac
import json
from typing import Iterable

from starlette.types import ASGIApp, Receive, Scope, Send

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Liveness/readiness probes stay open so container orchestrators can reach them.
_PUBLIC_PATHS = ("/health", "/api/health")


class RequestGuardMiddleware:
    """Pure ASGI middleware (streaming-safe) enforcing origin + token checks."""

    def __init__(self, app: ASGIApp, allowed_origins: Iterable[str], api_token: str = "") -> None:
        self.app = app
        self.allowed_origins = {o.rstrip("/") for o in allowed_origins}
        self.api_token = api_token or ""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        path = scope.get("path", "")
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}

        if method not in _SAFE_METHODS:
            origin = headers.get("origin")
            if origin is not None and origin.rstrip("/") not in self.allowed_origins:
                await _reject(send, 403, "Origin not allowed. Add it to CORS_ORIGINS in backend/.env.")
                return

        if (
            self.api_token
            and method != "OPTIONS"
            and path.startswith("/api")
            and not path.startswith(_PUBLIC_PATHS)
        ):
            supplied = headers.get("authorization", "")
            expected = f"Bearer {self.api_token}"
            if not hmac.compare_digest(supplied.encode(), expected.encode()):
                await _reject(send, 401, "Missing or invalid API token.")
                return

        await self.app(scope, receive, send)


async def _reject(send: Send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
    })
    await send({"type": "http.response.body", "body": body})
