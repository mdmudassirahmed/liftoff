"""Deploy endpoint input validation (argument injection, path traversal)."""
import pytest

from app.api.endpoints import deploy

BICEP = "param location string = resourceGroup().location\n"


@pytest.fixture()
def fake_az(monkeypatch):
    """Pretend we're signed in and record every az invocation."""
    calls = []

    async def fake_auth():
        return deploy.DeployStatusResponse(authenticated=True, subscription_id="x", user="me", subscription_name="sub")

    async def fake_run(args, cwd=None):
        calls.append(args)
        return 0, '{"changes": []}', ""

    monkeypatch.setattr(deploy, "check_az_auth", fake_auth)
    monkeypatch.setattr(deploy, "run_az_command", fake_run)
    return calls


def _body(**overrides):
    body = {"files": [{"path": "main.bicep", "content": BICEP}], "resource_group": "rg-demo", "location": "eastus"}
    body.update(overrides)
    return body


@pytest.mark.parametrize("rg", ["--query", "-h", "rg name", "rg;calc", "a" * 91, "ends."])
def test_rejects_malicious_resource_group(client, fake_az, rg):
    r = client.post("/api/deploy/what-if", json=_body(resource_group=rg))
    assert r.status_code == 422
    assert fake_az == []


@pytest.mark.parametrize("sub", ["--output", "not-a-guid", "1234"])
def test_rejects_bad_subscription(client, fake_az, sub):
    assert client.post("/api/deploy/what-if", json=_body(subscription_id=sub)).status_code == 422
    assert client.get("/api/deploy/resource-groups", params={"subscription_id": sub}).status_code == 422


def test_rejects_bad_location(client, fake_az):
    assert client.post("/api/deploy/what-if", json=_body(location="east us; rm")).status_code == 422


@pytest.mark.parametrize("path", ["../evil.bicep", "..\\evil.bicep", "/etc/passwd", "C:\\Windows\\x.bicep", "modules/../../x"])
def test_rejects_path_traversal(client, fake_az, path):
    files = [{"path": "main.bicep", "content": BICEP}, {"path": path, "content": "x"}]
    r = client.post("/api/deploy/what-if", json=_body(files=files))
    assert r.status_code == 400
    assert fake_az == []


def test_valid_what_if_passes_args_as_list(client, fake_az):
    sub = "00000000-0000-0000-0000-000000000000"
    r = client.post("/api/deploy/what-if", json=_body(resource_group="rg-demo_(1).x", subscription_id=sub))
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True
    args = fake_az[0]
    assert args[:3] == ["deployment", "group", "what-if"]
    assert args[args.index("-g") + 1] == "rg-demo_(1).x"
    assert args[args.index("--subscription") + 1] == sub
