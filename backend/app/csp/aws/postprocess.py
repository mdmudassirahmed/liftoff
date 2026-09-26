"""
AWS CloudFormation post-processor.

Deterministic passes that correct common LLM output errors, add a small set of
standard tags, and (only when configured) enforce an IAM permissions boundary.
Every pass is fail-safe: on any error the template is returned unchanged.
"""
import re

from app.core.config import get_settings
from app.csp.aws import cfn_yaml

_YAML_AVAILABLE = True  # PyYAML is a required dependency (see cfn_yaml)


# Standard tags added to every taggable resource that lacks them.
_STANDARD_TAGS = [
    {"Key": "ManagedBy", "Value": "liftoff"},
]

# Resource types that do not support Tags in CloudFormation (partial list).
_NO_TAG_SUPPORT = {
    "AWS::CloudFormation::WaitConditionHandle",
    "AWS::CloudFormation::WaitCondition",
    "AWS::IAM::InstanceProfile",
    "AWS::SSM::Association",
}

_BOUNDARY_TYPES = {"AWS::IAM::Role", "AWS::Lambda::Function"}


def _fix_cloudformation_syntax(template: str) -> str:
    """Apply deterministic fixes for frequent LLM mistakes. Never raises."""
    try:
        # Remove markdown code fences if the model added them
        template = re.sub(r"^```(?:yaml|yml)?\n?", "", template, flags=re.MULTILINE)
        template = re.sub(r"\n?```$", "", template, flags=re.MULTILINE)

        # Missing AWSTemplateFormatVersion
        if "AWSTemplateFormatVersion" not in template:
            template = 'AWSTemplateFormatVersion: "2010-09-09"\n' + template

        # Hardcoded arn:aws: -> arn:${AWS::Partition}: (before the !Sub pass below)
        template = template.replace("arn:aws:", "arn:${AWS::Partition}:")

        # Bare "${Param}" string values without !Sub -> wrap with !Sub
        def add_sub(m):
            return f'{m.group(1)}{m.group(2)} !Sub "{m.group(3)}"'

        template = re.sub(
            r'^( +)(\w[\w-]*:\s+)"([^"]*\$\{[^}]+\}[^"]*)"',
            add_sub,
            template,
            flags=re.MULTILINE,
        )
        template = template.lstrip("\n")
    except Exception:  # noqa: BLE001 - safety wrapper
        pass
    return template


def _load(template: str):
    """Parse a template, or None when it uses CloudFormation short-form tags
    (!Sub, !Ref, ...) that the safe YAML loader cannot represent."""
    if not _YAML_AVAILABLE:
        return None
    try:
        doc = cfn_yaml.load(template)
        return doc if isinstance(doc, dict) else None
    except Exception:  # noqa: BLE001
        return None


def _add_standard_tags(template: str) -> str:
    """Add the standard tags to taggable resources that lack them. Never raises."""
    doc = _load(template)
    if doc is None:
        return template
    try:
        resources = doc.get("Resources", {})
        if not isinstance(resources, dict):
            return template
        changed = False
        for res_body in resources.values():
            if not isinstance(res_body, dict) or res_body.get("Type") in _NO_TAG_SUPPORT:
                continue
            props = res_body.get("Properties")
            if not isinstance(props, dict):
                continue
            # Only extend an existing Tags list: many resource types (bucket
            # policies, IAM policies, ...) reject a Tags property entirely.
            tags = props.get("Tags")
            if not isinstance(tags, list):
                continue
            keys = {t.get("Key") for t in tags if isinstance(t, dict)}
            missing = [dict(t) for t in _STANDARD_TAGS if t["Key"] not in keys]
            if missing:
                props["Tags"] = tags + missing
                changed = True
        return cfn_yaml.dump(doc) if changed else template
    except Exception:  # noqa: BLE001
        return template


def _fix_permissions_boundary(template: str) -> str:
    """When AWS_PERMISSIONS_BOUNDARY_ARN is set, add it to every IAM role and Lambda
    function that lacks one. No-op otherwise. Never raises."""
    boundary = get_settings().AWS_PERMISSIONS_BOUNDARY_ARN
    if not boundary:
        return template
    doc = _load(template)
    if doc is None:
        return template
    try:
        resources = doc.get("Resources", {})
        if not isinstance(resources, dict):
            return template
        changed = False
        for res_body in resources.values():
            if not isinstance(res_body, dict) or res_body.get("Type") not in _BOUNDARY_TYPES:
                continue
            props = res_body.setdefault("Properties", {})
            if isinstance(props, dict) and not props.get("PermissionsBoundary"):
                props["PermissionsBoundary"] = boundary
                changed = True
        return cfn_yaml.dump(doc) if changed else template
    except Exception:  # noqa: BLE001
        return template


def postprocess_cloudformation(template: str) -> str:
    """Run all post-processors in order. Always returns a string, never raises."""
    template = _fix_cloudformation_syntax(template)
    template = _add_standard_tags(template)
    template = _fix_permissions_boundary(template)
    return template
