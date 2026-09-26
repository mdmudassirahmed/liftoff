"""Shared fixtures. Tests never touch Azure: Foundry and the az CLI are faked."""
import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# Deterministic settings regardless of a developer's local backend/.env.
os.environ["AZURE_AI_PROJECT_ENDPOINT"] = ""
os.environ["API_AUTH_TOKEN"] = ""
os.environ["GUARDRAILS_ENABLED"] = "true"
os.environ["IAC_REFERENCE_EXISTING_NETWORKS"] = "false"


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    import main

    with TestClient(main.app) as c:
        yield c


@pytest.fixture()
def sample_architecture():
    return {
        "nodes": [
            {"id": "1", "type": "service", "data": {"resourceType": "Microsoft.Storage/storageAccounts", "label": "sa1"}},
            {"id": "2", "type": "service", "data": {"resourceType": "Microsoft.KeyVault/vaults", "label": "kv1"}},
            {"id": "3", "type": "service", "data": {"resourceType": "Microsoft.Web/sites", "label": "func1"}},
            {"id": "g", "type": "group", "data": {"groupType": "resourceGroup"}},
        ],
        "edges": [],
    }
