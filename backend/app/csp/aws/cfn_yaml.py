"""
CloudFormation-aware YAML load/dump.

yaml.safe_load rejects CloudFormation short-form intrinsic functions (!Ref,
!Sub, !GetAtt, ...), which models use all the time. This loader converts each
short form to its equivalent long form ({"Ref": ...}, {"Fn::Sub": ...}, ...),
so templates can be parsed, transformed and dumped back as valid CloudFormation.
"""
from __future__ import annotations

from typing import Any

import yaml

_SHORT_FORMS = {
    "!Ref": "Ref",
    "!Condition": "Condition",
    "!Base64": "Fn::Base64",
    "!Cidr": "Fn::Cidr",
    "!FindInMap": "Fn::FindInMap",
    "!GetAtt": "Fn::GetAtt",
    "!GetAZs": "Fn::GetAZs",
    "!ImportValue": "Fn::ImportValue",
    "!Join": "Fn::Join",
    "!Select": "Fn::Select",
    "!Split": "Fn::Split",
    "!Sub": "Fn::Sub",
    "!Transform": "Fn::Transform",
    "!And": "Fn::And",
    "!Equals": "Fn::Equals",
    "!If": "Fn::If",
    "!Not": "Fn::Not",
    "!Or": "Fn::Or",
    "!Length": "Fn::Length",
    "!ToJsonString": "Fn::ToJsonString",
}


class CfnLoader(yaml.SafeLoader):
    """SafeLoader that understands CloudFormation short-form tags."""


def _construct_short_form(loader: yaml.SafeLoader, node: yaml.Node) -> dict:
    key = _SHORT_FORMS[node.tag]
    if isinstance(node, yaml.ScalarNode):
        value: Any = loader.construct_scalar(node)
        if key == "Fn::GetAtt" and isinstance(value, str):
            value = value.split(".", 1)  # !GetAtt Res.Attr -> ["Res", "Attr"]
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node, deep=True)
    else:
        value = loader.construct_mapping(node, deep=True)
    return {key: value}


for _tag in _SHORT_FORMS:
    CfnLoader.add_constructor(_tag, _construct_short_form)


class _CfnDumper(yaml.SafeDumper):
    """Keeps list items indented under their key, matching common CFN style."""

    def increase_indent(self, flow: bool = False, indentless: bool = False):  # noqa: D401
        return super().increase_indent(flow, False)


def load(text: str) -> Any:
    """Parse a CloudFormation YAML template (short forms become long forms)."""
    return yaml.load(text, Loader=CfnLoader)  # noqa: S506 - CfnLoader derives from SafeLoader


def dump(doc: Any) -> str:
    """Serialise a template as YAML using long-form intrinsic functions."""
    return yaml.dump(doc, Dumper=_CfnDumper, default_flow_style=False, sort_keys=False, allow_unicode=True)
