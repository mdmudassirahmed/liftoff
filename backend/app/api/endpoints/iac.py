"""
Infrastructure as Code generation endpoint.
Azure diagrams produce Bicep, Terraform or ARM; AWS diagrams produce CloudFormation.
"""
import re
from fastapi import APIRouter
from app.models.iac import IaCRequest, IaCResponse, IaCFormat, IaCResource, IaCValidateRequest
from app.agents.foundry import AgentRegistry
from app.api.errors import to_http_error
from app.core.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.post("/generate", response_model=IaCResponse)
async def generate_iac(request: IaCRequest):
    """
    Generate Infrastructure as Code from architecture diagram.
    
    - **architecture**: The diagram JSON from the frontend
    - **format**: Output format (bicep, terraform, arm; cloudformation for AWS)
    - **csp**: azure or aws (detected from the diagram when omitted)
    """
    try:
        from app.services.guardrails import detect_cloud

        csp = (request.csp or detect_cloud(request.architecture)).lower()
        logger.info(
            f"IaC generation request | csp={csp} | "
            f"format={request.format.value} | "
            f"nodes={len(request.architecture.get('nodes', []))}"
        )

        if csp == "aws":
            from app.csp import CSPRegistry

            result = await CSPRegistry.get_or_raise("aws").generate_iac(
                architecture=request.architecture, fmt="cloudformation", modular=False
            )
            code = result.get("template", "")
            return IaCResponse(
                code=code,
                format=IaCFormat.CLOUDFORMATION,
                resources=_extract_cf_resources(code),
                warnings=_get_aws_warnings(request.architecture),
                mcp_enhanced=False,
                compliance=_build_compliance(request.architecture, code, "cloudformation"),
            )

        # Call iac-generator-agent via registry
        response = await AgentRegistry.generate_iac(
            architecture=request.architecture,
            format=request.format.value
        )
        
        # Parse resources from the generated code
        resources = _extract_resources(response.content, request.format)

        logger.info(
            f"IaC generation completed | "
            f"format={request.format.value} | "
            f"code_length={len(response.content)} | "
            f"resources={len(resources)}"
        )

        # Guardrail compliance report (fail-safe: None if inactive/error).
        compliance = _build_compliance(request.architecture, response.content, request.format.value)

        return IaCResponse(
            code=response.content,
            format=request.format,
            resources=resources,
            warnings=_get_warnings(request.architecture),
            mcp_enhanced=True,  # Using Foundry agents
            compliance=compliance
        )
        
    except Exception as e:
        logger.error(f"IaC generation error: {e}", exc_info=True)
        raise to_http_error(e) from e


@router.post("/validate")
async def validate_iac(request: IaCValidateRequest):
    """
    Validate generated IaC code using validation-agent.

    - **code**: The IaC code to validate
    - **format**: The IaC format
    """
    try:
        # Call validation-agent via registry
        response = await AgentRegistry.validate_iac(
            template=request.code,
            template_type=request.format.value
        )
        
        # Parse validation response for errors/warnings
        content = response.content.lower()
        has_errors = any(word in content for word in ['error', 'invalid', 'fail'])
        
        return {
            "valid": not has_errors,
            "validation_report": response.content,
            "agent": response.agent_name
        }
        
    except Exception as e:
        logger.error(f"Validation error: {e}")
        raise to_http_error(e) from e


@router.get("/status")
async def get_iac_status():
    """Check if IaC agents are available."""
    try:
        agents = AgentRegistry.list_agents()
        return {
            "iac_generator_available": "iac_generator" in agents,
            "validation_available": "validation" in agents,
            "agents": list(agents.keys())
        }
    except Exception as e:
        return {
            "iac_generator_available": False,
            "validation_available": False,
            "error": str(e)
        }


def _build_compliance(architecture: dict, generated, fmt: str):
    """Build a guardrail compliance report. Fail-safe: returns None on any error."""
    try:
        from app.services import guardrails
        return guardrails.build_report(architecture, generated, fmt=fmt)
    except Exception as e:  # noqa: BLE001 - fail-safe by design
        logger.debug(f"Guardrail compliance report skipped: {e}")
        return None


def _extract_resources(code: str, format: IaCFormat) -> list[IaCResource]:
    """Extract individual resources from generated code."""
    resources = []
    
    if format == IaCFormat.BICEP:
        # Match Bicep resource declarations
        pattern = r"resource\s+(\w+)\s+'([^']+)'[^{]*\{([^}]+)\}"
        matches = re.findall(pattern, code, re.DOTALL)
        
        for match in matches:
            name, resource_type, body = match
            resources.append(IaCResource(
                resource_type=resource_type,
                name=name,
                code=f"resource {name} '{resource_type}' {{{body}}}"
            ))
    
    elif format == IaCFormat.TERRAFORM:
        # Match Terraform resource declarations
        pattern = r'resource\s+"([^"]+)"\s+"([^"]+)"[^{]*\{([^}]+)\}'
        matches = re.findall(pattern, code, re.DOTALL)
        
        for match in matches:
            resource_type, name, body = match
            resources.append(IaCResource(
                resource_type=resource_type,
                name=name,
                code=f'resource "{resource_type}" "{name}" {{{body}}}'
            ))
    
    return resources


def _get_warnings(architecture: dict) -> list[str]:
    """Generate warnings based on architecture analysis."""
    warnings = []
    nodes = architecture.get("nodes", [])
    
    # Check for common issues
    services = [n for n in nodes if n.get("type") == "azure.service"]
    groups = [n for n in nodes if n.get("type") == "azure.group"]
    
    if not groups:
        warnings.append("No resource groups defined - resources will need a resource group")
    
    # Check for orphan services
    orphan_services = [s for s in services if not s.get("parentId")]
    if orphan_services:
        warnings.append(f"{len(orphan_services)} service(s) are not in a resource group")
    
    # Check for common dependencies
    service_types = [s.get("data", {}).get("resourceType", "") for s in services]
    
    if "Microsoft.Web/sites" in service_types and "Microsoft.Web/serverfarms" not in service_types:
        warnings.append("App Service found without App Service Plan")
    
    if "Microsoft.ContainerService/managedClusters" in service_types:
        if "Microsoft.Network/virtualNetworks" not in service_types:
            warnings.append("AKS cluster found - consider adding a Virtual Network for network isolation")
    
    return warnings


def _get_aws_warnings(architecture: dict) -> list[str]:
    """Warnings based on AWS architecture analysis."""
    warnings = []
    services = [n for n in architecture.get("nodes", []) if n.get("type") in ("aws.service", "service")]
    service_types = [s.get("data", {}).get("resourceType", "") for s in services]

    from app.core.config import get_settings

    if get_settings().IAC_REFERENCE_EXISTING_NETWORKS:
        from app.csp.aws.prompt import get_network_resource_types

        found = [t for t in service_types if t in get_network_resource_types()]
        if found:
            warnings.append(
                f"Landing-zone mode: {', '.join(found)} must already exist and are referenced, not created."
            )
    if "AWS::Lambda::Function" in service_types and "AWS::IAM::Role" not in service_types:
        warnings.append("Lambda function without an IAM role - the template will add an execution role")
    return warnings


def _extract_cf_resources(code: str) -> list[IaCResource]:
    """Extract resource logical IDs from CloudFormation YAML."""
    return [
        IaCResource(resource_type=m.group(2), name=m.group(1), code="")
        for m in re.finditer(r"^  (\w+):\s*\n\s+Type:\s*(AWS::[^\s]+)", code, re.MULTILINE)
    ]
