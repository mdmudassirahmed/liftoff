"""
Modular CloudFormation splitter.

Takes a postprocessed CloudFormation template string and produces a list of
IaCModularFile-shaped dicts:
  - template.yaml: full self-contained deployable root (unchanged)
  - modules/<category>/<service>.yaml: standalone template per resource-type bucket
  - parameters/<env>.json: CloudFormation parameter file per environment (dev, test, prod)
  - README.md: layout description and deploy instructions

On any parse failure, returns a single-element list containing template.yaml,
preserving exactly the old stub behavior as a fallback.
"""
from __future__ import annotations

import json
from typing import Any

_YAML_AVAILABLE = True  # PyYAML is a required dependency (see cfn_yaml)

from app.csp.aws import cfn_yaml  # noqa: E402
from app.csp.aws.postprocess import postprocess_cloudformation  # noqa: E402


# Map AWS resource type prefix -> (category, service) for the modules/ folder layout.
_TYPE_BUCKET: list[tuple[str, tuple[str, str]]] = [
    ("AWS::Lambda::", ("compute", "lambda")),
    ("AWS::EC2::Instance", ("compute", "ec2")),
    ("AWS::EC2::", ("networking", "vpc")),  # catch-all for remaining EC2 types (EIP, KeyPair, etc.)
    ("AWS::AutoScaling::", ("compute", "autoscaling")),
    ("AWS::ECS::Cluster", ("containers", "ecs")),
    ("AWS::ECS::TaskDefinition", ("containers", "ecs")),
    ("AWS::ECS::Service", ("containers", "ecs")),
    ("AWS::EKS::", ("containers", "eks")),
    ("AWS::S3::", ("storage", "s3")),
    ("AWS::EFS::", ("storage", "efs")),
    ("AWS::DynamoDB::", ("database", "DynamoDB")),
    ("AWS::RDS::", ("database", "rds")),
    ("AWS::ElastiCache::", ("database", "elasticache")),
    ("AWS::Redshift::", ("analytics", "redshift")),
    ("AWS::Athena::", ("analytics", "athena")),
    ("AWS::Kinesis::", ("analytics", "kinesis")),
    ("AWS::Glue::", ("analytics", "glue")),
    ("AWS::IAM::", ("Identity", "IAM_Roles")),
    ("AWS::KMS::", ("security", "kms")),
    ("AWS::SecretsManager::", ("security", "secretsmanager")),
    ("AWS::Cognito::", ("security", "cognito")),
    ("AWS::SQS::", ("applicationIntegration", "SQS")),
    ("AWS::SNS::", ("applicationIntegration", "sns")),
    ("AWS::Events::", ("applicationIntegration", "EventBridge")),
    ("AWS::StepFunctions::", ("applicationIntegration", "stepfunctions")),
    ("AWS::ApiGateway::", ("applicationIntegration", "apigateway")),
    ("AWS::ApiGatewayV2::", ("applicationIntegration", "apigateway")),
    ("AWS::ElasticLoadBalancingV2::", ("networking", "alb")),
    ("AWS::CloudFront::", ("networking", "cloudfront")),
    ("AWS::Logs::", ("monitoring", "cloudwatch")),
    ("AWS::CloudWatch::", ("monitoring", "cloudwatch")),
    ("AWS::Bedrock::", ("ai", "bedrock")),
    ("AWS::SageMaker::", ("ai", "sagemaker")),
    ("AWS::SSM::", ("security", "ssm")),
    ("AWS::WAFv2::", ("security", "waf")),
    ("AWS::OpenSearchService::", ("analytics", "opensearch")),
    ("AWS::ElasticSearch::", ("analytics", "opensearch")),
    ("AWS::CodeBuild::", ("devops", "cicd")),
    ("AWS::CodePipeline::", ("devops", "cicd")),
    ("AWS::Backup::", ("operations", "backup")),
    ("AWS::ACM::", ("security", "acm")),
    ("AWS::Route53::", ("networking", "route53")),
]

_ENVS = ["dev", "test", "prod"]

# Standard parameters added to every module template (template params win).
_STANDARD_PARAMS: dict[str, Any] = {
    "Environment": {
        "Type": "String",
        "Description": "Deployment environment",
        "Default": "dev",
        "AllowedValues": list(_ENVS),
    },
    "AppName": {
        "Type": "String",
        "Description": "Application name used for naming and tagging",
        "Default": "liftoff-app",
    },
}

# Added only in landing-zone mode, where networking already exists.
_LANDING_ZONE_PARAMS: dict[str, Any] = {
    "VpcId": {
        "Type": "AWS::EC2::VPC::Id",
        "Description": "Existing VPC ID (never created by this template)",
    },
    "PrivateSubnets": {
        "Type": "List<AWS::EC2::Subnet::Id>",
        "Description": "Existing private subnet IDs",
    },
}


def _standard_params() -> dict[str, Any]:
    from app.core.config import get_settings

    params = dict(_STANDARD_PARAMS)
    if get_settings().IAC_REFERENCE_EXISTING_NETWORKS:
        params.update(_LANDING_ZONE_PARAMS)
    return params


def _classify_type(resource_type: str) -> tuple[str, str]:
    """Return (category, service) for a CloudFormation resource type."""
    for prefix, bucket in _TYPE_BUCKET:
        if resource_type == prefix or resource_type.startswith(prefix):
            return bucket
    return ("other", "misc")


def _make_parameter_file(params: dict, env: str) -> str:
    """Generate a CloudFormation [{ParameterKey, ParameterValue}] JSON array."""
    entries = []
    for key, defn in params.items():
        if key == "Environment":
            value = env
        else:
            raw = defn.get("Default", "")
            if isinstance(raw, list):
                value = ",".join(str(v) for v in raw)
            elif isinstance(raw, dict):
                value = json.dumps(raw)
            elif raw != "":
                value = str(raw)
            else:
                value = f"<{key}>"
        entries.append({"ParameterKey": key, "ParameterValue": value})
    return json.dumps(entries, indent=2)


def _build_module_template(
    resources: dict[str, Any],
    all_params: dict,
    category: str,
    service: str,
) -> str:
    """Build a standalone CloudFormation module template for one resource bucket."""
    outputs: dict[str, Any] = {}
    for res_name in resources:
        outputs[f"{res_name}Ref"] = {
            "Description": f"Reference to {res_name}",
            "Value": {"Ref": res_name},
            "Export": {"Name": {"Fn::Sub": f"${{AWS::StackName}}-{res_name}"}},
        }

    module: dict[str, Any] = {
        "AWSTemplateFormatVersion": "2010-09-09",
        "Description": f"{category}/{service} module - deploy independently via CI/CD",
        "Parameters": all_params,
        "Resources": resources,
        "Outputs": outputs,
    }
    return cfn_yaml.dump(module)


def split_cloudformation(template_str: str) -> list[dict]:
    """
    Split a CloudFormation template into a modular, reference-style file set.

    Returns list of dicts: {path, content, description}.
    Falls back to a single template.yaml on any parse/serialisation error.
    """
    fallback = [
        {
            "path": "template.yaml",
            "content": template_str,
            "description": "CloudFormation template",
        }
    ]

    if not _YAML_AVAILABLE:
        return fallback

    try:
        doc = cfn_yaml.load(template_str)
        if not isinstance(doc, dict):
            return fallback

        resources = doc.get("Resources", {})
        if not isinstance(resources, dict) or not resources:
            return fallback

        template_params = doc.get("Parameters", {})
        if not isinstance(template_params, dict):
            template_params = {}

        # Standard params at lowest priority; template params win
        merged_params: dict[str, Any] = _standard_params()
        merged_params.update(template_params)

        # Classify resources into (category, service) buckets
        buckets: dict[tuple[str, str], dict[str, Any]] = {}
        for res_name, res_body in resources.items():
            if not isinstance(res_body, dict):
                continue
            res_type = res_body.get("Type", "")
            key = _classify_type(res_type)
            if key not in buckets:
                buckets[key] = {}
            buckets[key][res_name] = res_body

        files: list[dict] = []

        # 1. Full deployable root (unchanged - this is what Deploy uses)
        files.append({
            "path": "template.yaml",
            "content": template_str,
            "description": "Full deployable CloudFormation template (consolidated root - used by Deploy)",
        })

        # 2. Standalone module per bucket (reference / CI-CD pattern)
        for (category, service), bucket_resources in sorted(buckets.items()):
            raw = _build_module_template(bucket_resources, merged_params, category, service)
            processed = postprocess_cloudformation(raw)
            files.append({
                "path": f"modules/{category}/{service}.yaml",
                "content": processed,
                "description": (
                    f"{category}/{service} module - standalone, independently deployable; "
                    f"{len(bucket_resources)} resource(s)"
                ),
            })

        # 3. Parameter files per environment
        for env in _ENVS:
            files.append({
                "path": f"parameters/{env}.json",
                "content": _make_parameter_file(merged_params, env),
                "description": f"CloudFormation parameter file for {env} environment",
            })

        # 4. README
        module_list_lines = [
            f"- `modules/{cat}/{svc}.yaml` ({len(res)} resource{'s' if len(res) != 1 else ''})"
            for (cat, svc), res in sorted(buckets.items())
        ]
        module_list = "\n".join(module_list_lines)
        networking_note = (
            "## Networking\n\n"
            "Landing-zone mode is on: templates never create networking. Provide the existing\n"
            "VPC and subnet IDs through the `VpcId` and `PrivateSubnets` parameters.\n"
            if "VpcId" in merged_params else ""
        )
        readme = (
            "# CloudFormation Modular Structure\n\n"
            "Generated by Liftoff.\n\n"
            "## Deploy\n\n"
            "Use `template.yaml` (the consolidated root) to deploy all resources in one step:\n\n"
            "```bash\n"
            "aws cloudformation deploy \\\n"
            "  --template-file template.yaml \\\n"
            "  --stack-name my-app-dev \\\n"
            "  --parameter-overrides file://parameters/dev.json \\\n"
            "  --capabilities CAPABILITY_NAMED_IAM\n"
            "```\n\n"
            "## Modules\n\n"
            "Each module is a standalone, independently deployable CloudFormation template,\n"
            "useful for fine-grained CI/CD pipelines or for reviewing one service at a time.\n\n"
            f"{module_list}\n\n"
            "## Parameter files\n\n"
            "One file per environment in `parameters/`: `dev`, `test`, `prod`.\n\n"
            f"{networking_note}"
        )
        files.append({
            "path": "README.md",
            "content": readme,
            "description": "Layout description and deploy instructions",
        })

        return files

    except Exception:  # noqa: BLE001 - safety net; always fall back
        return fallback
