"""API surface: health, request guard (origin / host / token), AI-not-configured."""
from app.core.config import get_settings


def test_root_and_health(client):
    root = client.get("/").json()
    assert root["name"] == "Liftoff API"
    assert root["ai_configured"] is False
    assert client.get("/health").json()["status"] == "healthy"
    assert client.get("/api/health").json()["service"] == "liftoff-backend"
    assert client.get("/api/health/live").json() == {"alive": True}


def test_openapi_schema_builds(client):
    paths = client.get("/openapi.json").json()["paths"]
    for p in ("/api/agents/iac/generate", "/api/agents/diagram/generate", "/api/deploy/what-if", "/api/chat/advisor"):
        assert p in paths


def test_cross_site_post_is_rejected(client):
    r = client.post("/api/agents/chat", json={"message": "hi"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_allowed_origin_passes_guard_and_gets_cors_headers(client):
    r = client.post("/api/agents/chat", json={"message": "hi"}, headers={"Origin": "http://localhost:5173"})
    assert r.status_code != 403
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_cors_preflight(client):
    r = client.options("/api/deploy/what-if", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    assert r.status_code == 200


def test_untrusted_host_header_is_rejected(client):
    assert client.get("/api/health", headers={"Host": "attacker.example"}).status_code == 400


def test_ai_endpoints_return_503_with_guidance_when_not_configured(client):
    r = client.post("/api/agents/diagram/generate", json={"prompt": "web app with sql"})
    assert r.status_code == 503
    assert "AZURE_AI_PROJECT_ENDPOINT" in r.json()["detail"]


def test_api_token_enforced_when_configured():
    """The guard is built from settings at import time, so exercise it directly."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.core.security import RequestGuardMiddleware

    app = FastAPI()

    @app.get("/api/thing")
    def thing():
        return {"ok": True}

    @app.get("/api/health")
    def health():
        return {"ok": True}

    app.add_middleware(RequestGuardMiddleware, allowed_origins=["http://localhost:5173"], api_token="s3cret")
    c = TestClient(app)
    assert c.get("/api/thing").status_code == 401
    assert c.get("/api/thing", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.get("/api/thing", headers={"Authorization": "Bearer s3cret"}).status_code == 200
    assert c.get("/api/health").status_code == 200  # probes stay open


def test_csv_settings_parse(monkeypatch):
    from app.core.config import Settings

    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test")
    s = Settings(_env_file=None)
    assert s.CORS_ORIGINS == ["http://a.test", "http://b.test"]
    assert get_settings().HOST == "127.0.0.1"
