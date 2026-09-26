"""
Security guardrail service.

Loads the bundled guardrail catalog + service map (app/data/guardrails/) and
provides pure functions to:

  - match_guardrails(architecture): find guardrails relevant to a diagram
  - build_prompt_constraints(matched): compact text injected into the IaC
    generation prompt so templates come out compliant-by-default
  - build_report(architecture, generated, fmt): a ComplianceReport combining
    matched guardrails with deterministic static checks over the generated IaC

Fail-safe by design: if the catalog/map is missing or malformed, or anything
throws, every public function degrades to an empty/no-op result so the existing
IaC generation path behaves exactly as it does today. Nothing here raises to
callers.
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "guardrails"
_CATALOG_PATH = _DATA_DIR / "azure_guardrails.json"
_SERVICE_MAP_PATH = _DATA_DIR / "service_map.json"

# Higher rank = more severe (used for sorting and prompt capping).
_SEVERITY_RANK = {
    "critical": 5,
    "high": 4,
    "medium": 3,
    "low": 2,
    "informational": 1,
    "none": 0,
    "": 0,
}

# CVE/patch-remediation guardrails are runtime-specific (e.g. a Java Spring or
# Node.js CVE) and do not describe infrastructure a template can set. They are
# categorized separately so they never drown out the enforceable controls in
# the UI. Matching is service-level, so these ride along with a resource type
# even when the chosen runtime is unaffected.
_CVE_RE = re.compile(r"\bCVE-\d", re.IGNORECASE)


def _categorize(status: str, recommendation: str, risk: str) -> str:
    """Classify a guardrail row for presentation.

    control      -> deterministically checked (pass/warn); the template enforces it
    vulnerability -> CVE/patch remediation (runtime-specific, not infra)
    guidance     -> everything else advisory (operational / identity / prose-only)
    """
    if status in ("pass", "warn"):
        return "control"
    if _CVE_RE.search(f"{recommendation or ''} {risk or ''}"):
        return "vulnerability"
    return "guidance"


# --------------------------------------------------------------------------- #
# Enablement / loading
# --------------------------------------------------------------------------- #

def is_enabled() -> bool:
    """Feature flag (GUARDRAILS_ENABLED). Default ON."""
    return bool(get_settings().GUARDRAILS_ENABLED)


@lru_cache(maxsize=1)
def _load_raw() -> Dict[str, Any]:
    """Load catalog + service map once. Returns {} on any failure."""
    try:
        catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
        service_map = json.loads(_SERVICE_MAP_PATH.read_text(encoding="utf-8"))
        return {"catalog": catalog, "service_map": service_map}
    except Exception as e:  # noqa: BLE001 - fail-safe by design
        logger.warning("Guardrail catalog unavailable, guardrails inactive: %s", e)
        return {}


def catalog_available() -> bool:
    """True when both data files loaded successfully."""
    return bool(_load_raw())


def active() -> bool:
    """Guardrails are applied only when both enabled and data is present."""
    return is_enabled() and catalog_available()


def load_catalog(csp: str = "AZURE", user_actionable_only: bool = True) -> List[Dict[str, Any]]:
    """Return guardrail rows for a CSP, filtered to user-actionable by default."""
    raw = _load_raw()
    if not raw:
        return []
    rows = raw["catalog"].get(csp.upper(), [])
    if user_actionable_only:
        rows = [r for r in rows if r.get("user_actionable")]
    return rows


def _service_map(csp: str = "AZURE") -> Dict[str, Any]:
    raw = _load_raw()
    if not raw:
        return {}
    return raw["service_map"].get(csp.upper(), {})


@lru_cache(maxsize=8)
def _reverse_index(csp: str = "AZURE") -> Dict[str, List[str]]:
    """resource_type (lowercased) -> [catalog service names]."""
    idx: Dict[str, List[str]] = {}
    for service, meta in _service_map(csp).items():
        for rt in meta.get("azure_resource_types", []) or []:
            idx.setdefault(rt.lower(), []).append(service)
    return idx


# --------------------------------------------------------------------------- #
# Matching
# --------------------------------------------------------------------------- #

def _sort_by_severity(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        rows,
        key=lambda r: (-_SEVERITY_RANK.get((r.get("severity") or "").lower(), 0), r.get("control_id", "")),
    )


def _dedupe(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for r in rows:
        key = r.get("control_id") or json.dumps(r, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def match_guardrails(architecture: Dict[str, Any], csp: str = "AZURE") -> Dict[str, Any]:
    """
    Match user-actionable guardrails to a diagram.

    Returns:
        {
          "by_resource": { "<Microsoft.X/Y>": [guardrail, ...], ... },
          "environment": [guardrail, ...],
          "resource_count": int,      # distinct resource-attached guardrails
          "environment_count": int,
        }
    Always returns this shape; empty on any failure.
    """
    empty = {"by_resource": {}, "environment": [], "resource_count": 0, "environment_count": 0}
    try:
        rows = load_catalog(csp=csp, user_actionable_only=True)
        if not rows:
            return empty

        by_service: Dict[str, List[Dict[str, Any]]] = {}
        for r in rows:
            by_service.setdefault(r.get("service", ""), []).append(r)

        rev = _reverse_index(csp)

        # Collect resource types present in the diagram. Read data.resourceType on
        # ANY node (frontend uses type 'service'; backend code elsewhere uses
        # 'azure.service' - reading the field directly sidesteps that mismatch).
        present: Dict[str, str] = {}  # lower -> canonical (first seen)
        for node in (architecture.get("nodes") or []):
            if not isinstance(node, dict):
                continue
            data = node.get("data") or {}
            rt = str(data.get("resourceType") or "").strip()
            if rt:
                present.setdefault(rt.lower(), rt)

        by_resource: Dict[str, List[Dict[str, Any]]] = {}
        resource_seen = set()
        for rt_lower, rt_canon in present.items():
            guardrails: List[Dict[str, Any]] = []
            for svc in rev.get(rt_lower, []):
                guardrails.extend(by_service.get(svc, []))
            guardrails = _dedupe(guardrails)
            if guardrails:
                by_resource[rt_canon] = _sort_by_severity(guardrails)
                for g in guardrails:
                    resource_seen.add(g.get("control_id"))

        # Environment / identity guardrails (no node mapping).
        env_services = [s for s, m in _service_map(csp).items() if m.get("scope") == "environment"]
        env_rows: List[Dict[str, Any]] = []
        for svc in env_services:
            env_rows.extend(by_service.get(svc, []))
        env_rows = _sort_by_severity(_dedupe(env_rows))

        return {
            "by_resource": by_resource,
            "environment": env_rows,
            "resource_count": len(resource_seen),
            "environment_count": len(env_rows),
        }
    except Exception as e:  # noqa: BLE001 - fail-safe by design
        logger.warning("match_guardrails failed, returning empty: %s", e)
        return empty


# --------------------------------------------------------------------------- #
# Prompt constraints (compliant-by-default)
# --------------------------------------------------------------------------- #

def _one_line(text: str, limit: int = 180) -> str:
    s = re.sub(r"\s+", " ", (text or "").strip())
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def build_prompt_constraints(
    matched: Dict[str, Any],
    max_per_resource: int = 6,
    max_total: int = 40,
) -> str:
    """
    Build a compact guardrail block to append to the generation prompt.

    Returns "" when there is nothing to add, so callers can safely do
    `prompt + build_prompt_constraints(...)`.
    """
    try:
        by_resource = matched.get("by_resource") or {}
        if not by_resource:
            return ""

        lines: List[str] = []
        total = 0
        for rt, guardrails in by_resource.items():
            if total >= max_total:
                break
            block: List[str] = []
            for g in guardrails[:max_per_resource]:
                if total >= max_total:
                    break
                sev = (g.get("severity") or "").upper() or "N/A"
                rec = _one_line(g.get("recommendation") or g.get("risk") or "")
                if not rec:
                    continue
                block.append(f"  - [{sev}] {rec}")
                total += 1
            if block:
                lines.append(f"{rt}:")
                lines.extend(block)

        if not lines:
            return ""

        header = (
            "\n\nSECURITY GUARDRAILS - the generated template MUST "
            "comply with these where the property applies. Express each as a concrete "
            "resource property (secure defaults). If a guardrail cannot be expressed in "
            "the template, add a short comment noting it:\n"
        )
        return header + "\n".join(lines) + "\n"
    except Exception as e:  # noqa: BLE001 - fail-safe by design
        logger.warning("build_prompt_constraints failed, returning empty: %s", e)
        return ""


# Exact, deterministically-verifiable secure properties per resource type. These
# mirror the checks in _CHECKS one-for-one so that "compliant-by-default" output
# actually passes verification (turns "to fix" into "met"). Property names are
# Bicep/ARM; the agent maps them to the Terraform equivalent when needed.
_ENFORCED_PROPERTIES: Dict[str, List[str]] = {
    "Microsoft.Storage/storageAccounts": [
        "properties.supportsHttpsTrafficOnly: true",
        "properties.minimumTlsVersion: 'TLS1_2'",
        "properties.allowBlobPublicAccess: false",
        "properties.publicNetworkAccess: 'Disabled'",
        "properties.networkAcls.defaultAction: 'Deny'",
        "properties.networkAcls.bypass: 'AzureServices'",
        "properties.encryption.keySource: 'Microsoft.Storage'",
    ],
    "Microsoft.KeyVault/vaults": [
        "properties.enableSoftDelete: true",
        "properties.softDeleteRetentionInDays: 90",
        "properties.enablePurgeProtection: true",
        "properties.enableRbacAuthorization: true",
        "properties.publicNetworkAccess: 'Disabled'",
        "properties.networkAcls.defaultAction: 'Deny'",
        "properties.networkAcls.bypass: 'AzureServices'",
    ],
    "Microsoft.Web/sites": [
        "properties.httpsOnly: true",
        "properties.siteConfig.minTlsVersion: '1.2'",
        "properties.publicNetworkAccess: 'Disabled'",
    ],
    "Microsoft.Sql/servers": [
        "properties.publicNetworkAccess: 'Disabled'",
    ],
    "Microsoft.DocumentDB/databaseAccounts": [
        "properties.publicNetworkAccess: 'Disabled'",
    ],
    "Microsoft.CognitiveServices/accounts": [
        "properties.publicNetworkAccess: 'Disabled'",
    ],
}

# Resource types whose enforced baseline turns public network access OFF. An
# approved per-service networking exception can only flip THESE back on; the
# other hardening (HTTPS, TLS, soft-delete, ...) is never waived.
_PUBLIC_ACCESS_ENFORCED = {
    rt for rt, props in _ENFORCED_PROPERTIES.items()
    if any("publicnetworkaccess" in p.lower() for p in props)
}

# When an app (Microsoft.Web/sites) sits next to a data/secret service we lock
# down, the app authenticates via its managed identity using this least-privilege
# built-in role. Keeps hardening from costing application functionality.
_IDENTITY_ROLES: Dict[str, str] = {
    "Microsoft.KeyVault/vaults": "Key Vault Secrets User",
    "Microsoft.Storage/storageAccounts": "Storage Blob Data Contributor",
    "Microsoft.DocumentDB/databaseAccounts": "Cosmos DB Built-in Data Contributor",
    "Microsoft.CognitiveServices/accounts": "Cognitive Services User",
}


def reference_existing_networks() -> bool:
    """True when networking is centrally managed (hub-spoke / landing zone).

    Controlled by IAC_REFERENCE_EXISTING_NETWORKS. When on, generated IaC must
    reference pre-existing VNets/subnets instead of creating them.
    """
    return bool(get_settings().IAC_REFERENCE_EXISTING_NETWORKS)


def _connectivity_instruction() -> str:
    """Step 3 of the identity block; wording depends on who owns networking."""
    if reference_existing_networks():
        return (
            "  3. Provide the private connectivity the app needs to reach the "
            "locked-down resources by REFERENCING the existing, centrally managed "
            "network: regional VNet integration for the app and a private endpoint "
            "(+ private DNS zone) for each dependent Key Vault / Storage account, all "
            "bound to the EXISTING subnet (use the provided subnetResourceId when "
            "present). NEVER create a virtual network, subnet, route table, NSG, or "
            "private DNS zone. If no existing subnet is supplied, expose it as a "
            "parameter (e.g. existingSubnetResourceId) and add a comment that the "
            "network team must provide it before deployment.\n"
        )
    return (
        "  3. Provide the private connectivity the app needs to reach the "
        "locked-down resources: regional VNet integration for the app and a private "
        "endpoint (+ private DNS zone) for each dependent Key Vault / Storage "
        "account. Reuse the VNet/subnet from the diagram when one exists (use the "
        "provided subnetResourceId when present); otherwise create a dedicated VNet "
        "with an app-integration subnet and a private-endpoint subnet.\n"
    )


def build_identity_requirements(matched: Dict[str, Any], fmt: str = "bicep") -> str:
    """
    Emit the identity + connectivity the app needs so that locking dependent
    resources down (public access disabled) never breaks the deployed app.

    Disabling public network access blocks the app at the NETWORK layer; a
    managed identity only fixes AUTHORIZATION. So when an app and a dependent
    Key Vault / Storage / Cosmos / AI account are both in the diagram we require:
      1. a system-assigned managed identity on every app,
      2. a least-privilege RBAC role assignment to each dependent resource,
      3. the private connectivity (VNet integration + private endpoint + private
         DNS) needed to reach a resource whose public access is disabled,
      4. secret access via Key Vault references / managed identity, never inline.

    Returns "" when it does not apply, so callers can safely concatenate.
    """
    try:
        by_resource = matched.get("by_resource") or {}
        if not by_resource:
            return ""
        present = {rt.lower() for rt in by_resource}
        if "microsoft.web/sites" not in present:
            return ""
        deps = [(rt, role) for rt, role in _IDENTITY_ROLES.items() if rt.lower() in present]
        if not deps:
            return ""
        role_lines = "\n".join(f"  - {rt} -> assign built-in role '{role}'" for rt, role in deps)
        tf = str(fmt).lower() == "terraform"
        mi_hint = (
            'identity { type = "SystemAssigned" } + azurerm_role_assignment'
            if tf
            else "identity: { type: 'SystemAssigned' } + Microsoft.Authorization/roleAssignments"
        )
        return (
            "\n\nMANDATORY IDENTITY & CONNECTIVITY - public network access "
            "is disabled on the resources above, so the app must still be able to "
            "reach AND authenticate to them. Do ALL of the following so the deployed "
            "application keeps working (never account keys, connection strings, or "
            "Key Vault access policies):\n"
            f"  1. Enable a system-assigned managed identity on every Microsoft.Web/sites ({mi_hint}).\n"
            "  2. Grant that identity least-privilege RBAC on each dependent resource, "
            "scoped to that resource, using the app's identity principalId:\n"
            f"{role_lines}\n"
            f"{_connectivity_instruction()}"
            "  4. Read secrets via Key Vault references / managed identity, not "
            "inline secret values.\n"
        )
    except Exception as e:  # noqa: BLE001 - fail-safe by design
        logger.warning("build_identity_requirements failed, returning empty: %s", e)
        return ""


def build_enforced_properties(matched: Dict[str, Any], fmt: str = "bicep") -> str:
    """
    Build a strict "mandatory secure properties" block for the resource types
    present in the diagram. This is the teeth behind compliant-by-default: it
    names exact property/value pairs the deterministic checker verifies, so the
    generated template reliably satisfies the enforceable guardrail controls.

    Returns "" when nothing applies, so callers can safely concatenate.
    """
    try:
        by_resource = matched.get("by_resource") or {}
        if not by_resource:
            return ""
        present = {rt.lower() for rt in by_resource}
        lines: List[str] = []
        for rt, props in _ENFORCED_PROPERTIES.items():
            if rt.lower() in present:
                lines.append(f"{rt}:")
                lines.extend(f"  - {p}" for p in props)
        if not lines:
            return ""
        tf_note = " (use the snake_case Terraform equivalents)" if str(fmt).lower() == "terraform" else ""
        header = (
            "\n\nMANDATORY SECURE PROPERTIES (non-negotiable){note} - set "
            "EXACTLY these values on the matching resources so the template is "
            "verifiably compliant. Do not omit any:\n"
        ).format(note=tf_note)
        return header + "\n".join(lines) + "\n"
    except Exception as e:  # noqa: BLE001 - fail-safe by design
        logger.warning("build_enforced_properties failed, returning empty: %s", e)
        return ""


# --------------------------------------------------------------------------- #
# Approved networking exceptions (per-service, documented)
# --------------------------------------------------------------------------- #

def collect_network_exceptions(architecture: Dict[str, Any]) -> List[Dict[str, str]]:
    """
    Return the services the user has explicitly flagged as an approved exception
    to the public-network-access baseline.

    An exception only applies when the service is NOT integrated with a VNet
    (vnetIntegrationEnabled falsy): if a private path exists, there is nothing to
    waive. Returns [] on any failure so callers can safely iterate.
    """
    out: List[Dict[str, str]] = []
    try:
        for node in (architecture.get("nodes") or []):
            if not isinstance(node, dict):
                continue
            data = node.get("data") or {}
            if not data.get("networkExceptionEnabled"):
                continue
            if data.get("vnetIntegrationEnabled"):
                # Private connectivity present - the exception is moot.
                continue
            out.append({
                "name": str(data.get("label") or data.get("name") or data.get("title") or "").strip(),
                "resource_type": str(data.get("resourceType") or "").strip(),
                "justification": str(data.get("networkExceptionJustification") or "").strip(),
            })
    except Exception as e:  # noqa: BLE001 - fail-safe by design
        logger.warning("collect_network_exceptions failed: %s", e)
    return out


def build_networking_exceptions(architecture: Dict[str, Any], fmt: str = "bicep") -> str:
    """
    Emit an override block for services with an approved networking exception.

    For ONLY the named resources, public network access is turned back ON (they
    have no VNet/private endpoint to reach them otherwise) while every other
    hardening stays in place. All other resources keep public access disabled.
    Appended AFTER the mandatory-properties block so it wins for those names.

    Returns "" when there is nothing to override, so callers can concatenate.
    """
    try:
        excs = collect_network_exceptions(architecture)
        if not excs:
            return ""
        lines: List[str] = []
        for e in excs:
            rt = e.get("resource_type") or ""
            if rt not in _PUBLIC_ACCESS_ENFORCED:
                continue
            name = e.get("name") or "(unnamed resource)"
            reason = e.get("justification") or "documented business exception"
            lines.append(
                f"  - {name} ({rt}): set properties.publicNetworkAccess to 'Enabled' "
                f"and do NOT add VNet integration, a private endpoint, or a subnet "
                f"reference for it. Reason: {reason}"
            )
        if not lines:
            return ""
        return (
            "\n\nAPPROVED NETWORKING EXCEPTIONS (documented) - the resources "
            "below have an APPROVED exception to the public-network-access baseline "
            "(no virtual network is available to them). For ONLY these named "
            "resources, OVERRIDE the mandatory secure property above and set "
            "publicNetworkAccess to 'Enabled'. Keep all other secure properties "
            "(HTTPS-only, minimum TLS, encryption, soft-delete, etc.). Every resource "
            "NOT listed here keeps publicNetworkAccess 'Disabled':\n"
            + "\n".join(lines) + "\n"
        )
    except Exception as e:  # noqa: BLE001 - fail-safe by design
        logger.warning("build_networking_exceptions failed, returning empty: %s", e)
        return ""


# --------------------------------------------------------------------------- #
# Deterministic compliance checks
# --------------------------------------------------------------------------- #

def _to_text(generated: Union[str, List[Any], Dict[str, Any], None]) -> str:
    """Normalize single template / modular files / response dict to one text blob."""
    if generated is None:
        return ""
    if isinstance(generated, str):
        return generated
    if isinstance(generated, dict):
        if "files" in generated:
            return _to_text(generated.get("files"))
        if "content" in generated:
            return str(generated.get("content") or "")
        if "code" in generated:
            return str(generated.get("code") or "")
        return json.dumps(generated)
    if isinstance(generated, list):
        parts = []
        for item in generated:
            if isinstance(item, dict):
                parts.append(str(item.get("content") or item.get("code") or ""))
            else:
                parts.append(str(item))
        return "\n".join(parts)
    return str(generated)


def _prop_affirmative(text: str, prop: str) -> bool:
    """True if `prop` is set to true (bicep `:`/json/terraform `=`), case-insensitive."""
    return bool(re.search(rf"{re.escape(prop)}\s*[:=]\s*[\"']?true", text, re.IGNORECASE))


def _prop_value(text: str, prop: str, values: List[str]) -> bool:
    """True if `prop` is set to one of `values` (quoted or not), case-insensitive."""
    alt = "|".join(re.escape(v) for v in values)
    return bool(re.search(rf"{re.escape(prop)}\s*[:=]\s*[\"']?({alt})[\"']?", text, re.IGNORECASE))


# Each check: applies to a resource type, has a severity, a detector over the
# concatenated generated text, and keywords used to link it back to the matched
# guardrail(s) for that resource type so their status can be flipped.
_CHECKS: List[Dict[str, Any]] = [
    {
        "id": "storage-https-only",
        "resource_type": "Microsoft.Storage/storageAccounts",
        "title": "Storage enforces HTTPS-only traffic",
        "severity": "high",
        "keywords": ["https", "secure transfer", "supportshttps"],
        "detect": lambda t: _prop_affirmative(t, "supportsHttpsTrafficOnly"),
    },
    {
        "id": "storage-no-public-blob",
        "resource_type": "Microsoft.Storage/storageAccounts",
        "title": "Storage disables public blob access",
        "severity": "high",
        "keywords": ["public blob", "public access", "public container", "allowblobpublic", "anonymous"],
        "detect": lambda t: bool(re.search(r"allowBlobPublicAccess\s*[:=]\s*[\"']?false", t, re.IGNORECASE)),
    },
    {
        "id": "storage-min-tls",
        "resource_type": "Microsoft.Storage/storageAccounts",
        "title": "Storage requires TLS 1.2 minimum",
        "severity": "medium",
        "keywords": ["tls"],
        "detect": lambda t: _prop_value(t, "minimumTlsVersion", ["TLS1_2", "TLS1_3"]),
    },
    {
        "id": "keyvault-purge-protection",
        "resource_type": "Microsoft.KeyVault/vaults",
        "title": "Key Vault enables purge protection",
        "severity": "high",
        "keywords": ["purge protection", "purgeprotection"],
        "detect": lambda t: _prop_affirmative(t, "enablePurgeProtection"),
    },
    {
        "id": "keyvault-soft-delete",
        "resource_type": "Microsoft.KeyVault/vaults",
        "title": "Key Vault enables soft delete",
        "severity": "medium",
        "keywords": ["soft delete", "soft-delete", "softdelete"],
        "detect": lambda t: _prop_affirmative(t, "enableSoftDelete") or _prop_value(t, "softDeleteRetentionInDays", [str(n) for n in range(7, 91)]),
    },
    {
        "id": "web-https-only",
        "resource_type": "Microsoft.Web/sites",
        "title": "App/Function enforces HTTPS-only",
        "severity": "high",
        "keywords": ["https only", "httpsonly", "https"],
        "detect": lambda t: _prop_affirmative(t, "httpsOnly"),
    },
    {
        "id": "web-min-tls",
        "resource_type": "Microsoft.Web/sites",
        "title": "App/Function requires TLS 1.2 minimum",
        "severity": "medium",
        "keywords": ["tls"],
        "detect": lambda t: _prop_value(t, "minTlsVersion", ["1.2", "1.3"]),
    },
    {
        "id": "sql-no-public-network",
        "resource_type": "Microsoft.Sql/servers",
        "title": "SQL server disables public network access",
        "severity": "high",
        "keywords": ["public network", "publicnetworkaccess", "private endpoint"],
        "detect": lambda t: _prop_value(t, "publicNetworkAccess", ["Disabled"]),
    },
    {
        "id": "cosmos-no-public-network",
        "resource_type": "Microsoft.DocumentDB/databaseAccounts",
        "title": "Cosmos DB disables public network access",
        "severity": "high",
        "keywords": ["public network", "publicnetworkaccess", "private endpoint"],
        "detect": lambda t: _prop_value(t, "publicNetworkAccess", ["Disabled"]),
    },
    {
        "id": "cognitive-no-public-network",
        "resource_type": "Microsoft.CognitiveServices/accounts",
        "title": "AI/OpenAI account disables public network access",
        "severity": "high",
        "keywords": ["public network", "publicnetworkaccess", "private endpoint"],
        "detect": lambda t: _prop_value(t, "publicNetworkAccess", ["Disabled"]),
    },
    {
        "id": "web-no-public-network",
        "resource_type": "Microsoft.Web/sites",
        "title": "App/Function disables public network access",
        "severity": "high",
        "keywords": ["public network access", "publicnetworkaccess", "public access", "allow public access"],
        "detect": lambda t: _prop_value(t, "publicNetworkAccess", ["Disabled"]),
    },
    {
        "id": "storage-no-public-network",
        "resource_type": "Microsoft.Storage/storageAccounts",
        "title": "Storage disables public network access",
        "severity": "high",
        "keywords": ["public network access", "publicnetworkaccess", "network access",
                     "block public access", "selected virtual networks", "selected networks",
                     "trusted microsoft services"],
        "detect": lambda t: _prop_value(t, "publicNetworkAccess", ["Disabled"]) or _prop_value(t, "defaultAction", ["Deny"]),
    },
    {
        "id": "storage-encryption-at-rest",
        "resource_type": "Microsoft.Storage/storageAccounts",
        "title": "Storage enforces encryption at rest (SSE)",
        "severity": "high",
        "keywords": ["encryption at rest", "storage service encryption", "sse"],
        # SSE is always on for Azure Storage; treat any encryption block / keySource as satisfied.
        "detect": lambda t: _prop_value(t, "keySource", ["Microsoft.Storage", "Microsoft.Keyvault"]) or bool(re.search(r"encryption", t, re.IGNORECASE)),
    },
    {
        "id": "keyvault-no-public-network",
        "resource_type": "Microsoft.KeyVault/vaults",
        "title": "Key Vault restricts access to private networks",
        "severity": "high",
        "keywords": ["private network", "service endpoint", "private link",
                     "publicnetworkaccess", "public network access"],
        "detect": lambda t: _prop_value(t, "publicNetworkAccess", ["Disabled"]) or _prop_value(t, "defaultAction", ["Deny"]),
    },
]


def _severity_summary(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    counts = {k: 0 for k in ("critical", "high", "medium", "low", "informational", "none")}
    for r in rows:
        sev = (r.get("severity") or "none").lower()
        counts[sev] = counts.get(sev, 0) + 1
    return counts


def build_report(
    architecture: Dict[str, Any],
    generated: Union[str, List[Any], Dict[str, Any], None],
    fmt: str = "bicep",
    csp: str = "AZURE",
) -> Optional[Dict[str, Any]]:
    """
    Build a ComplianceReport for a generated template set.

    Returns None when guardrails are inactive (flag off or catalog missing) or on
    any error, so the caller attaches nothing and behavior is unchanged.
    """
    if not active():
        return None
    try:
        matched = match_guardrails(architecture, csp=csp)
        by_resource = matched.get("by_resource") or {}
        environment = matched.get("environment") or []
        # Only report when at least one diagram resource matched. Environment
        # guardrails are supplementary and shown alongside real resources; on
        # their own (empty/unmapped diagram) they would just add noise.
        if not by_resource:
            return None

        text = _to_text(generated)

        # Approved, documented networking exceptions. Public-access controls on an
        # exempted resource type are reported as accepted (advisory), never as a
        # failed control, so an intentional deviation does not read as a gap.
        exceptions = collect_network_exceptions(architecture)
        exception_types = {e["resource_type"].lower() for e in exceptions if e.get("resource_type")}

        # Run deterministic checks for resource types actually present.
        checks_out: List[Dict[str, Any]] = []
        # control_id -> status ('pass'|'warn') from a linked check
        status_by_control: Dict[str, str] = {}
        present_types_lower = {rt.lower(): rt for rt in by_resource}
        for chk in _CHECKS:
            rt_lower = chk["resource_type"].lower()
            if rt_lower not in present_types_lower:
                continue
            # A public-network control on an exempted type is an accepted exception.
            is_net_exception = chk["id"].endswith("-no-public-network") and rt_lower in exception_types
            try:
                passed = bool(chk["detect"](text))
            except Exception:  # noqa: BLE001
                passed = False
            status = "advisory" if is_net_exception else ("pass" if passed else "warn")
            entry = {
                "id": chk["id"],
                "resource_type": present_types_lower[rt_lower],
                "title": chk["title"],
                "severity": chk["severity"],
                "status": status,
            }
            if is_net_exception:
                entry["accepted_exception"] = True
            checks_out.append(entry)
            # An accepted exception must not flip its linked guardrails to a failure.
            if is_net_exception:
                continue
            # Link to matched guardrails by keyword to flip their per-row status.
            for g in by_resource.get(present_types_lower[rt_lower], []):
                hay = f"{g.get('recommendation','')} {g.get('risk','')} {g.get('azure_policy','')}".lower()
                if any(kw in hay for kw in chk["keywords"]):
                    control = g.get("control_id")
                    # A failing check should not downgrade a pass from another check.
                    if status == "warn" or status_by_control.get(control) != "warn":
                        status_by_control[control] = status

        def _row(g: Dict[str, Any]) -> Dict[str, Any]:
            status = status_by_control.get(g.get("control_id"), "advisory")
            recommendation = g.get("recommendation", "")
            risk = g.get("risk", "")
            return {
                "control_id": g.get("control_id", ""),
                "service": g.get("service", ""),
                "layer": g.get("layer", ""),
                "severity": (g.get("severity") or "none").lower(),
                "status": status,
                "category": _categorize(status, recommendation, risk),
                "recommendation": recommendation,
                "risk": risk,
                "benchmark": g.get("benchmark", ""),
                "azure_policy": g.get("azure_policy", ""),
            }

        by_resource_out = [
            {"resource_type": rt, "guardrails": [_row(g) for g in guardrails]}
            for rt, guardrails in by_resource.items()
        ]
        environment_out = [_row(g) for g in environment]

        all_rows = [g for rows in by_resource.values() for g in rows] + list(environment)

        return {
            "enabled": True,
            "format": fmt,
            "summary": {
                "guardrails_total": len(_dedupe(all_rows)),
                "resource_guardrails": matched.get("resource_count", 0),
                "environment_guardrails": matched.get("environment_count", 0),
                "by_severity": _severity_summary(_dedupe(all_rows)),
                "checks_passed": sum(1 for c in checks_out if c["status"] == "pass"),
                "checks_failed": sum(1 for c in checks_out if c["status"] == "warn"),
            },
            "checks": checks_out,
            "by_resource": by_resource_out,
            "environment": environment_out,
            "exceptions": exceptions,
        }
    except Exception as e:  # noqa: BLE001 - fail-safe by design
        logger.warning("build_report failed, returning None: %s", e)
        return None
