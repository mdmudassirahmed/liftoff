"""AWS support: cloud detection, guardrails, CloudFormation post-processing and
modular output, and the AWS endpoints. No AWS or network access needed."""
import asyncio
import json
import re

import pytest

from app.core.config import get_settings
from app.csp.aws import modularize, postprocess
from app.services import guardrails

AWS_ARCH = {
    "nodes": [
        {"id": "acct", "type": "aws.group", "data": {"groupType": "awsAccount", "label": "acct"}},
        {"id": "b", "type": "aws.service", "parentId": "acct", "data": {"resourceType": "AWS::S3::Bucket", "label": "docs"}},
        {"id": "db", "type": "aws.service", "parentId": "acct", "data": {"resourceType": "AWS::RDS::DBInstance", "label": "db"}},
        {"id": "fn", "type": "aws.service", "parentId": "acct", "data": {"resourceType": "AWS::Lambda::Function", "label": "api"}},
    ],
    "edges": [{"id": "e1", "source": "fn", "target": "b"}],
}

SECURE_CFN = """AWSTemplateFormatVersion: "2010-09-09"
Resources:
  Docs:
    Type: AWS::S3::Bucket
    Properties:
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: aws:kms
  DocsPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref Docs
      PolicyDocument:
        Statement:
          - Effect: Deny
            Principal: "*"
            Action: "s3:*"
            Resource:
              - !GetAtt Docs.Arn
              - !Sub "${Docs.Arn}/*"
            Condition:
              Bool:
                aws:SecureTransport: false
  Db:
    Type: AWS::RDS::DBInstance
    Properties:
      PubliclyAccessible: false
      StorageEncrypted: true
"""

INSECURE_CFN = """AWSTemplateFormatVersion: "2010-09-09"
Resources:
  Docs:
    Type: AWS::S3::Bucket
  Db:
    Type: AWS::RDS::DBInstance
    Properties:
      PubliclyAccessible: true
"""


# --------------------------------------------------------------------------- cloud detection

def test_detect_cloud():
    assert guardrails.detect_cloud(AWS_ARCH) == "AWS"
    assert guardrails.detect_cloud({"nodes": [{"data": {"resourceType": "Microsoft.Web/sites"}}]}) == "AZURE"
    assert guardrails.detect_cloud({}) == "AZURE"


# --------------------------------------------------------------------------- guardrails

def test_aws_catalog_is_well_formed():
    rows = guardrails.load_catalog("AWS", user_actionable_only=False)
    assert len(rows) >= 30
    assert all(r["benchmark"].startswith("AWS FSBP ") for r in rows)
    assert all(r["control_id"].startswith("LFT-AWS-") for r in rows)


def test_aws_report_passes_secure_template():
    report = guardrails.build_report(AWS_ARCH, SECURE_CFN, fmt="cloudformation")
    assert report is not None
    passed = {c["id"] for c in report["checks"] if c["status"] == "pass"}
    assert {"aws-s3-block-public-access", "aws-s3-encryption", "aws-s3-tls-only",
            "aws-rds-no-public-access", "aws-rds-encryption"} <= passed
    assert report["summary"]["checks_failed"] == 0
    assert report["environment"], "account-level controls are surfaced"


def test_aws_report_flags_insecure_template():
    report = guardrails.build_report(AWS_ARCH, INSECURE_CFN, fmt="cloudformation")
    failed = {c["id"] for c in report["checks"] if c["status"] == "warn"}
    assert "aws-rds-no-public-access" in failed and "aws-s3-block-public-access" in failed


def test_aws_prompt_constraints_use_cloudformation_names():
    text = guardrails.build_enforced_properties(guardrails.match_guardrails(AWS_ARCH))
    assert "CloudFormation property names" in text
    assert "PubliclyAccessible: false" in text
    assert "Microsoft." not in text


# --------------------------------------------------------------------------- post-processing

def test_postprocess_fixes_common_llm_mistakes():
    raw = "```yaml\nResources:\n  Q:\n    Type: AWS::SQS::Queue\n    Properties:\n      Arn: arn:aws:sqs:x\n```"
    out = postprocess.postprocess_cloudformation(raw)
    assert out.startswith("AWSTemplateFormatVersion:") and "2010-09-09" in out.splitlines()[0]
    assert "```" not in out
    assert "arn:aws:" not in out


def test_short_form_intrinsics_survive_a_round_trip():
    """Models write !Ref/!Sub/!GetAtt; parsing must not fail and output stays valid CFN."""
    from app.csp.aws import cfn_yaml

    doc = cfn_yaml.load(SECURE_CFN)
    policy = doc["Resources"]["DocsPolicy"]["Properties"]
    assert policy["Bucket"] == {"Ref": "Docs"}
    assert policy["PolicyDocument"]["Statement"][0]["Resource"][0] == {"Fn::GetAtt": ["Docs", "Arn"]}
    assert cfn_yaml.load(cfn_yaml.dump(doc)) == doc


def test_postprocess_adds_standard_tags_and_nothing_proprietary():
    # Includes a short-form tag: tagging must still work on real model output.
    raw = ('AWSTemplateFormatVersion: "2010-09-09"\nResources:\n  B:\n    Type: AWS::S3::Bucket\n'
           '    Properties:\n      BucketName: !Sub "${AWS::StackName}-docs"\n      Tags: []\n')
    out = postprocess.postprocess_cloudformation(raw)
    assert "Fn::Sub" in out
    assert "ManagedBy" in out and "liftoff" in out
    assert "PermissionsBoundary" not in out  # only when AWS_PERMISSIONS_BOUNDARY_ARN is set


def test_tags_are_never_added_to_resources_without_a_tags_list():
    """AWS::S3::BucketPolicy has no Tags property: adding one breaks the template."""
    out = postprocess.postprocess_cloudformation(SECURE_CFN)
    from app.csp.aws import cfn_yaml

    assert "Tags" not in cfn_yaml.load(out)["Resources"]["DocsPolicy"]["Properties"]


def test_permissions_boundary_only_when_configured(monkeypatch):
    raw = 'AWSTemplateFormatVersion: "2010-09-09"\nResources:\n  R:\n    Type: AWS::IAM::Role\n    Properties:\n      Tags: []\n'
    monkeypatch.setattr(get_settings(), "AWS_PERMISSIONS_BOUNDARY_ARN", "arn:aws:iam::123456789012:policy/Boundary")
    assert "arn:aws:iam::123456789012:policy/Boundary" in postprocess.postprocess_cloudformation(raw)


# --------------------------------------------------------------------------- modular output

def test_split_cloudformation_layout():
    files = {f["path"]: f["content"] for f in modularize.split_cloudformation(SECURE_CFN)}
    assert "template.yaml" in files and "README.md" in files
    assert {"parameters/dev.json", "parameters/test.json", "parameters/prod.json"} <= set(files)
    assert any(p.startswith("modules/storage/") for p in files)
    assert any(p.startswith("modules/database/") for p in files)
    params = json.loads(files["parameters/prod.json"])
    assert {"ParameterKey": "Environment", "ParameterValue": "prod"} in params
    assert "VpcId" not in {p["ParameterKey"] for p in params}  # only in landing-zone mode
    # Generated output must never carry baked-in account IDs or fixed environment names.
    blob = "\n".join(files.values())
    assert not re.search(r"\b\d{12}\b", blob), "hardcoded AWS account ID"
    envs = {json.loads(files[p])[0]["ParameterValue"] for p in files if p.startswith("parameters/")}
    assert envs == {"dev", "test", "prod"}


def test_split_adds_network_params_in_landing_zone_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "IAC_REFERENCE_EXISTING_NETWORKS", True)
    files = {f["path"]: f["content"] for f in modularize.split_cloudformation(SECURE_CFN)}
    assert "VpcId" in {p["ParameterKey"] for p in json.loads(files["parameters/dev.json"])}


# --------------------------------------------------------------------------- endpoints

@pytest.fixture()
def fake_agent(monkeypatch):
    """Replace AgentRegistry.chat; record prompts and return canned output."""
    from app.agents.foundry import registry

    calls = []

    async def fake_chat(cls, agent_type, message, context=None):
        from app.agents.foundry.foundry_client import AgentResponse

        calls.append({"agent_type": agent_type, "message": message})
        if "diagram generator" in message:
            content = json.dumps({"nodes": AWS_ARCH["nodes"], "edges": AWS_ARCH["edges"]})
        else:
            content = SECURE_CFN
        return AgentResponse(content=content, agent_name="fake", agent_type=agent_type)

    monkeypatch.setattr(registry.AgentRegistry, "chat", classmethod(fake_chat))
    return calls


def test_diagram_generation_uses_aws_schema(client, fake_agent):
    r = client.post("/api/agents/diagram/generate", json={"prompt": "serverless API", "csp": "aws"})
    assert r.status_code == 200, r.text
    assert "AWS architecture diagram generator" in fake_agent[0]["message"]
    assert r.json()["diagram"]["nodes"][1]["data"]["resourceType"] == "AWS::S3::Bucket"


def test_aws_iac_generation_returns_cloudformation_and_report(client, fake_agent):
    r = client.post("/api/agents/iac/generate", json={"architecture": AWS_ARCH, "modular": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["format"] == "cloudformation"
    assert any(f["path"] == "template.yaml" for f in body["files"])
    assert body["compliance"]["checks"], "guardrail report attached"
    assert fake_agent[0]["agent_type"] == "aws_iac_generator"


def test_top_bar_iac_endpoint_routes_aws(client, fake_agent):
    r = client.post("/api/iac/generate", json={"architecture": AWS_ARCH, "format": "cloudformation"})
    assert r.status_code == 200, r.text
    assert r.json()["format"] == "cloudformation"
    assert {x["resource_type"] for x in r.json()["resources"]} >= {"AWS::S3::Bucket", "AWS::RDS::DBInstance"}


def test_cf_schema_endpoint(client):
    body = client.get("/api/agents/aws/cf-schema", params={"resourceType": "AWS::Lambda::Function"}).json()
    assert "Code" in body["cfProperties"]["required"]
    assert client.get("/api/agents/aws/cf-schema", params={"resourceType": "AWS::Nope::Nope"}).status_code == 404
    assert len(client.get("/api/agents/aws/cf-schema").json()["services"]) >= 30


@pytest.mark.parametrize("body", [
    {"template_yaml": "x", "stack_name": "--bad name"},
    {"template_yaml": "x", "stack_name": "ok", "region": "not a region"},
])
def test_aws_deploy_validates_input(client, body):
    assert client.post("/api/agents/aws/deploy", json=body).status_code == 422


def test_cfn_lint_gate_blocks_invalid_templates():
    pytest.importorskip("cfnlint")
    from app.csp.aws.deploy import _lint_template

    assert _lint_template(SECURE_CFN) == []
    bad = 'AWSTemplateFormatVersion: "2010-09-09"\nResources:\n  B:\n    Type: AWS::S3::Bucket\n    Properties:\n      NotARealProperty: true\n'
    assert any(e.startswith("E3002") for e in _lint_template(bad))


def test_aws_plugin_skips_correction_when_template_is_clean(fake_agent):
    from app.csp import CSPRegistry

    result = asyncio.run(CSPRegistry.get_or_raise("aws").generate_iac(AWS_ARCH, "cloudformation", modular=False))
    assert result["format"] == "cloudformation"
    assert len(fake_agent) == 1  # no correction round for a lint-clean template
