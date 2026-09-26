"""Guardrail catalog, matching, prompt constraints and compliance report."""
import json
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.services import guardrails

DATA = Path(guardrails.__file__).resolve().parent.parent / "data" / "guardrails"

GOOD_BICEP = """
resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'sa1'
  properties: {
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', bypass: 'AzureServices' }
    encryption: { keySource: 'Microsoft.Storage' }
  }
}
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv1'
  properties: {
    enableSoftDelete: true
    enablePurgeProtection: true
    enableRbacAuthorization: true
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', bypass: 'AzureServices' }
  }
}
resource func 'Microsoft.Web/sites@2023-12-01' = {
  name: 'func1'
  identity: { type: 'SystemAssigned' }
  properties: {
    httpsOnly: true
    publicNetworkAccess: 'Disabled'
    siteConfig: { minTlsVersion: '1.2' }
  }
}
"""

BAD_BICEP = """
resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'sa1'
  properties: { supportsHttpsTrafficOnly: false, allowBlobPublicAccess: true }
}
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = { name: 'kv1', properties: {} }
resource func 'Microsoft.Web/sites@2023-12-01' = { name: 'func1', properties: {} }
"""


def test_catalog_loads_and_is_well_formed():
    assert guardrails.catalog_available()
    rows = guardrails.load_catalog(user_actionable_only=False)
    assert len(rows) >= 100
    service_map = json.loads((DATA / "service_map.json").read_text(encoding="utf-8"))["AZURE"]
    ids = [r["control_id"] for r in rows]
    assert len(ids) == len(set(ids)), "control ids must be unique"
    for r in rows:
        assert r["service"] in service_map, r["control_id"]
        assert r["severity"].lower() in guardrails._SEVERITY_RANK
        assert r["recommendation"] and r["risk"] and r["benchmark"].startswith("MCSB ")


def test_matching_unions_services_sharing_a_resource_type(sample_architecture):
    matched = guardrails.match_guardrails(sample_architecture)
    br = matched["by_resource"]
    assert {"Microsoft.Storage/storageAccounts", "Microsoft.KeyVault/vaults", "Microsoft.Web/sites"} <= set(br)
    services = {g["service"] for g in br["Microsoft.Web/sites"]}
    assert {"App Service", "Function App"} <= services
    assert matched["environment_count"] > 0


def test_prompt_constraints_name_resources(sample_architecture):
    text = guardrails.build_prompt_constraints(guardrails.match_guardrails(sample_architecture))
    assert "SECURITY GUARDRAILS" in text
    assert "Microsoft.Storage/storageAccounts" in text


def test_good_template_passes_every_check(sample_architecture):
    report = guardrails.build_report(sample_architecture, GOOD_BICEP, fmt="bicep")
    assert report is not None
    assert report["summary"]["checks_failed"] == 0
    assert report["summary"]["checks_passed"] >= 10
    passed = {c["id"] for c in report["checks"] if c["status"] == "pass"}
    assert {"web-no-public-network", "storage-no-public-network",
            "storage-encryption-at-rest", "keyvault-no-public-network"} <= passed
    # Checks flip linked catalog rows to enforced controls.
    statuses = {row["control_id"]: (row["status"], row["category"])
                for grp in report["by_resource"] for row in grp["guardrails"]}
    for cid in ("LFT-STG-01", "LFT-STG-02", "LFT-KV-01", "LFT-WEB-01"):
        assert statuses[cid] == ("pass", "control"), cid


def test_bad_template_fails_checks(sample_architecture):
    report = guardrails.build_report(sample_architecture, BAD_BICEP, fmt="bicep")
    assert report["summary"]["checks_failed"] > 0


def test_modular_file_list_is_accepted(sample_architecture):
    files = [{"path": "main.bicep", "content": GOOD_BICEP}]
    report = guardrails.build_report(sample_architecture, {"files": files})
    assert report["summary"]["checks_failed"] == 0


def test_identity_block_requires_identity_and_private_connectivity(sample_architecture):
    block = guardrails.build_identity_requirements(guardrails.match_guardrails(sample_architecture))
    assert "Key Vault Secrets User" in block and "Storage Blob Data Contributor" in block
    assert "SystemAssigned" in block and "private endpoint" in block.lower()
    no_app = guardrails.match_guardrails(
        {"nodes": [{"data": {"resourceType": "Microsoft.Storage/storageAccounts"}}]})
    assert guardrails.build_identity_requirements(no_app) == ""


def test_network_exception_is_reported_as_accepted(sample_architecture):
    arch = json.loads(json.dumps(sample_architecture))
    arch["nodes"][0]["data"].update(networkExceptionEnabled=True, networkExceptionJustification="public website")
    report = guardrails.build_report(arch, BAD_BICEP)
    check = next(c for c in report["checks"] if c["id"] == "storage-no-public-network")
    assert check["status"] == "advisory" and check.get("accepted_exception")
    assert "public website" in guardrails.build_networking_exceptions(arch)


def test_empty_or_unmapped_architecture_returns_no_report():
    assert guardrails.build_report({"nodes": []}, "") is None
    assert guardrails.match_guardrails({"nodes": "garbage"})["by_resource"] == {}


@pytest.mark.parametrize("flag, expect_reference", [(False, False), (True, True)])
def test_landing_zone_mode_changes_connectivity_wording(monkeypatch, sample_architecture, flag, expect_reference):
    monkeypatch.setattr(get_settings(), "IAC_REFERENCE_EXISTING_NETWORKS", flag)
    block = guardrails.build_identity_requirements(guardrails.match_guardrails(sample_architecture))
    assert ("NEVER create a virtual network" in block) is expect_reference


def test_disabled_flag_turns_reports_off(monkeypatch, sample_architecture):
    monkeypatch.setattr(get_settings(), "GUARDRAILS_ENABLED", False)
    assert guardrails.build_report(sample_architecture, GOOD_BICEP) is None


def test_report_severities_are_lowercase(sample_architecture):
    """The frontend keys its badge styles on lowercase severities."""
    report = guardrails.build_report(sample_architecture, GOOD_BICEP)
    rows = [r for grp in report["by_resource"] for r in grp["guardrails"]] + report["environment"]
    assert rows and all(r["severity"] == r["severity"].lower() for r in rows)


EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


@pytest.mark.parametrize("example", sorted(p.name for p in EXAMPLES.glob("*.json")))
def test_bundled_examples_match_guardrails(example):
    architecture = json.loads((EXAMPLES / example).read_text(encoding="utf-8"))
    matched = guardrails.match_guardrails(architecture)
    assert matched["resource_count"] > 0
    assert guardrails.build_report(architecture, "") is not None
