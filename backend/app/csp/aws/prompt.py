"""AWS CloudFormation prompt builder."""
import json
from typing import Any, Dict

from app.core.config import get_settings

# Networking resource types that landing-zone mode (IAC_REFERENCE_EXISTING_NETWORKS)
# references instead of creating: a platform team owns them.
_NETWORK_RESOURCE_TYPES = [
    "AWS::EC2::VPC",
    "AWS::EC2::Subnet",
    "AWS::EC2::InternetGateway",
    "AWS::EC2::NatGateway",
    "AWS::EC2::RouteTable",
    "AWS::EC2::SubnetRouteTableAssociation",
    "AWS::Route53::HostedZone",
    "AWS::EC2::TransitGateway",
    "AWS::EC2::TransitGatewayAttachment",
    "AWS::EC2::VPCPeeringConnection",
]

_CF_RULES = (
    "You are an AWS CloudFormation template generator.\n"
    "Return ONLY valid YAML CloudFormation (no markdown, no commentary).\n"
    "\n"
    "MANDATORY RULES:\n"
    '1. Always include: AWSTemplateFormatVersion: "2010-09-09"\n'
    "2. Use !Sub for variable substitution, never bare ${Param} without !Sub\n"
    "3. All ARNs must use the arn:${AWS::Partition}: prefix (never hardcode arn:aws:)\n"
    "4. Never use !Ref for ARNs; use !GetAtt ResourceName.Arn or !Sub\n"
    "5. Tags must be YAML list format: [{Key: ..., Value: ...}]\n"
    "6. S3 buckets: PublicAccessBlockConfiguration with BlockPublicAcls, BlockPublicPolicy, IgnorePublicAcls and RestrictPublicBuckets all true; BucketEncryption with SSEAlgorithm aws:kms or AES256; a bucket policy that denies requests where aws:SecureTransport is false\n"
    "7. S3 buckets: VersioningConfiguration Status: Enabled; DeletionPolicy: Retain; UpdateReplacePolicy: Retain\n"
    "8. RDS/Aurora: StorageEncrypted: true; PubliclyAccessible: false; DeletionProtection: true; BackupRetentionPeriod >= 7; MultiAZ: true\n"
    "9. Lambda functions: an execution role with least-privilege permissions; TracingConfig Mode: Active\n"
    "10. DynamoDB tables: BillingMode: PAY_PER_REQUEST; PointInTimeRecoverySpecification PointInTimeRecoveryEnabled: true; SSESpecification SSEEnabled: true; DeletionProtectionEnabled: true\n"
    "11. SQS queues: SqsManagedSseEnabled: true; pair each queue with a dead-letter queue (suffix -dlq)\n"
    "12. Secrets Manager secrets: GenerateSecretString with PasswordLength 24 - never inline secret values\n"
    "13. KMS keys: EnableKeyRotation: true\n"
    "14. EC2 instances: MetadataOptions HttpTokens: required (IMDSv2); no public IP unless the diagram requires one; encrypted EBS volumes\n"
    "15. IAM roles: trust policy scoped to the minimal principal; no wildcard actions on wildcard resources\n"
    "16. CloudWatch log groups: RetentionInDays: 30 (minimum)\n"
    "17. EKS clusters: EndpointPublicAccess false, EndpointPrivateAccess true\n"
    "18. Use Parameters for: Environment (AllowedValues: [dev, test, prod]) and AppName (String); tag every taggable resource with Application: !Ref AppName and Environment: !Ref Environment\n"
    "19. Build SQS URLs and similar endpoints with !Sub and pseudo parameters (${AWS::Region}, ${AWS::AccountId}) - never hardcode account IDs or regions\n"
)

_LANDING_ZONE_RULES = (
    "\nLANDING-ZONE NETWORKING (MANDATORY): networking is owned by a platform team and already exists.\n"
    "- Never create: " + ", ".join(_NETWORK_RESOURCE_TYPES) + "\n"
    "- Reference networking with Parameters of Type AWS::EC2::VPC::Id (VpcId) and "
    "List<AWS::EC2::Subnet::Id> (PrivateSubnets).\n"
)


def build_aws_iac_prompt(architecture: Dict[str, Any], extra_context: str = "") -> str:
    """Build the full prompt for the AWS IaC generator agent."""
    settings = get_settings()
    parts = [_CF_RULES]
    if settings.IAC_REFERENCE_EXISTING_NETWORKS:
        parts.append(_LANDING_ZONE_RULES)
    if settings.AWS_PERMISSIONS_BOUNDARY_ARN:
        parts.append(
            "\nAll IAM roles and Lambda functions: PermissionsBoundary "
            f"'{settings.AWS_PERMISSIONS_BOUNDARY_ARN}'.\n"
        )
    if extra_context:
        parts.append(extra_context)
    parts.append(f"\nArchitecture to implement:\n{_summarize_architecture(architecture)}")
    parts.append("\nGenerate a complete CloudFormation template in YAML:")
    return "\n".join(parts)


def _summarize_architecture(architecture: Dict[str, Any]) -> str:
    """Compact JSON summary of the architecture for the prompt."""
    nodes = architecture.get("nodes", [])
    edges = architecture.get("edges", [])
    summary = {
        "services": [
            {
                "id": n["id"],
                "type": n.get("data", {}).get("resourceType", n.get("type", "")),
                "label": n.get("data", {}).get("label", n.get("data", {}).get("title", "")),
                "properties": n.get("data", {}).get("properties", {}),
            }
            for n in nodes
            if n.get("type") in ("aws.service", "service")
        ],
        "groups": [
            {
                "id": n["id"],
                "type": n.get("data", {}).get("groupType", ""),
                "label": n.get("data", {}).get("label", ""),
            }
            for n in nodes
            if n.get("type") in ("aws.group", "group")
        ],
        "connections": [{"from": e["source"], "to": e["target"]} for e in edges],
    }
    return json.dumps(summary, indent=2)


def get_network_resource_types() -> list[str]:
    """Networking resource types that landing-zone mode references instead of creating."""
    return list(_NETWORK_RESOURCE_TYPES)
