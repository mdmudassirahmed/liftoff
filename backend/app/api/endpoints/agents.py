"""
Agent API endpoints.

Simple REST API to call Azure AI Foundry agents.
All agents are created/managed in Foundry portal.
"""
import time
from typing import Optional, List, Dict, Any, Union
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.errors import to_http_error
from app.core.logging import get_logger, set_correlation_id
from app.agents.foundry import AgentRegistry, AgentType

router = APIRouter()
logger = get_logger(__name__)


def _build_compliance(architecture: dict, generated, fmt: str):
    """Build a guardrail compliance report. Fail-safe: returns None on any error."""
    try:
        from app.services import guardrails
        return guardrails.build_report(architecture, generated, fmt=fmt)
    except Exception as e:  # noqa: BLE001 - fail-safe by design
        logger.debug(f"Guardrail compliance report skipped: {e}")
        return None


# ==================== Request/Response Models ====================

class AgentChatRequest(BaseModel):
    """Request for agent chat."""
    message: str = Field(..., description="User message to send to agent")
    agent_type: Optional[str] = Field(
        None, 
        description="Agent type: orchestrator, iac_generator, azure_docs, security_advisor, validation"
    )
    context: Optional[Dict[str, Any]] = Field(
        None,
        description="Additional context (e.g., architecture JSON)"
    )


class AgentChatResponse(BaseModel):
    """Response from agent chat."""
    content: str
    agent_type: str
    agent_name: str
    duration_ms: float


class IaCGenerateRequest(BaseModel):
    """Request for IaC generation."""
    architecture: Dict[str, Any] = Field(..., description="Architecture diagram JSON")
    format: str = Field("bicep", description="Output format: bicep or terraform")
    modular: bool = Field(False, description="Generate modular structure with separate files")


class IaCGenerateResponse(BaseModel):
    """Response from IaC generation."""
    template: str
    format: str
    agent_name: str
    duration_ms: float
    compliance: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Security guardrail compliance report (None when guardrails inactive)"
    )


class IaCModularFile(BaseModel):
    """A single file in a modular IaC structure."""
    path: str = Field(..., description="Relative file path (e.g., 'modules/compute/appService.bicep')")
    content: str = Field(..., description="File content")
    description: str = Field("", description="Brief description of this file")


class IaCModularResponse(BaseModel):
    """Response for modular IaC generation."""
    files: List[IaCModularFile] = Field(..., description="List of files in the modular structure")
    format: str
    agent_name: str
    duration_ms: float
    structure_summary: str = Field("", description="Summary of the generated structure")
    compliance: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Security guardrail compliance report (None when guardrails inactive)"
    )


class IaCValidateRequest(BaseModel):
    """Request for IaC validation."""
    template: str = Field(..., description="IaC template content to validate")
    template_type: str = Field("bicep", description="Template type: bicep or terraform")


class IaCValidateResponse(BaseModel):
    """Response from IaC validation."""
    result: str
    agent_name: str
    duration_ms: float


class SecurityAnalyzeRequest(BaseModel):
    """Request for security analysis."""
    architecture: Dict[str, Any] = Field(..., description="Architecture diagram JSON")
    compliance_frameworks: List[str] = Field(
        default=["asb"],
        description="Compliance frameworks to check"
    )


class SecurityAnalyzeResponse(BaseModel):
    """Response from security analysis."""
    analysis: str
    agent_name: str
    duration_ms: float


class DocSearchRequest(BaseModel):
    """Request for documentation search."""
    query: str = Field(..., description="Search query")


class DocSearchResponse(BaseModel):
    """Response from documentation search."""
    results: str
    agent_name: str
    duration_ms: float


class DiagramFromPromptRequest(BaseModel):
    """Request for generating diagram from natural language prompt."""
    prompt: str = Field(..., description="Natural language description of desired architecture")


class DiagramFromPromptResponse(BaseModel):
    """Response containing generated diagram JSON."""
    diagram: Dict[str, Any] = Field(..., description="Generated diagram with nodes and edges")
    agent_name: str
    duration_ms: float


# ==================== Endpoints ====================

@router.post("/chat", response_model=AgentChatResponse)
async def agent_chat(request: AgentChatRequest):
    """
    Chat with a specific Azure AI Foundry agent.
    """
    set_correlation_id()
    start_time = time.perf_counter()
    
    agent_type = request.agent_type or AgentType.ORCHESTRATOR
    
    logger.info(f"Agent chat request | agent_type={agent_type}")
    
    try:
        response = await AgentRegistry.chat(
            agent_type=agent_type,
            message=request.message,
            context=request.context
        )
        
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        
        return AgentChatResponse(
            content=response.content,
            agent_type=response.agent_type,
            agent_name=response.agent_name,
            duration_ms=elapsed_ms
        )
        
    except Exception as e:
        logger.error(f"Agent chat failed: {e}")
        raise to_http_error(e) from e


@router.post("/iac/generate", response_model=Union[IaCGenerateResponse, IaCModularResponse])
async def generate_iac(request: IaCGenerateRequest):
    """
    Generate IaC templates using iac-generator-agent.
    """
    set_correlation_id()
    start_time = time.perf_counter()
    
    logger.info(f"IaC generation request | format={request.format} | modular={request.modular}")
    
    try:
        if request.modular:
            # Generate modular structure with separate files
            response = await AgentRegistry.generate_iac_modular(
                architecture=request.architecture,
                format=request.format
            )
            
            elapsed_ms = (time.perf_counter() - start_time) * 1000

            # Guardrail compliance over all module files combined (fail-safe: None if inactive/error).
            combined = "\n\n".join(
                f.get("content", "") for f in response.get("files", [])
            )
            compliance = _build_compliance(request.architecture, combined, request.format)

            return IaCModularResponse(
                files=[
                    IaCModularFile(
                        path=f["path"],
                        content=f["content"],
                        description=f.get("description", "")
                    )
                    for f in response.get("files", [])
                ],
                format=request.format,
                agent_name=response.get("agent_name", "iac-generator-agent"),
                duration_ms=elapsed_ms,
                structure_summary=response.get("structure_summary", ""),
                compliance=compliance
            )
        else:
            # Generate single file template
            response = await AgentRegistry.generate_iac(
                architecture=request.architecture,
                format=request.format
            )
            
            elapsed_ms = (time.perf_counter() - start_time) * 1000

            # Guardrail compliance over the generated template (fail-safe: None if inactive/error).
            compliance = _build_compliance(request.architecture, response.content, request.format)

            return IaCGenerateResponse(
                template=response.content,
                format=request.format,
                agent_name=response.agent_name,
                duration_ms=elapsed_ms,
                compliance=compliance
            )
        
    except Exception as e:
        logger.error(f"IaC generation failed: {e}")
        raise to_http_error(e) from e


@router.post("/iac/validate", response_model=IaCValidateResponse)
async def validate_iac(request: IaCValidateRequest):
    """
    Validate IaC templates using validation-agent.
    """
    set_correlation_id()
    start_time = time.perf_counter()
    
    logger.info(f"IaC validation request | type={request.template_type}")
    
    try:
        response = await AgentRegistry.validate_iac(
            template=request.template,
            template_type=request.template_type
        )
        
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        
        return IaCValidateResponse(
            result=response.content,
            agent_name=response.agent_name,
            duration_ms=elapsed_ms
        )
        
    except Exception as e:
        logger.error(f"IaC validation failed: {e}")
        raise to_http_error(e) from e


@router.post("/security/analyze", response_model=SecurityAnalyzeResponse)
async def analyze_security(request: SecurityAnalyzeRequest):
    """
    Analyze architecture security using security-advisor-agent.
    """
    set_correlation_id()
    start_time = time.perf_counter()
    
    logger.info("Security analysis request")
    
    try:
        response = await AgentRegistry.analyze_security(
            architecture=request.architecture,
            compliance_frameworks=request.compliance_frameworks
        )
        
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        
        return SecurityAnalyzeResponse(
            analysis=response.content,
            agent_name=response.agent_name,
            duration_ms=elapsed_ms
        )
        
    except Exception as e:
        logger.error(f"Security analysis failed: {e}")
        raise to_http_error(e) from e


@router.post("/docs/search", response_model=DocSearchResponse)
async def search_docs(request: DocSearchRequest):
    """
    Search Azure documentation using azure-docs-agent.
    """
    set_correlation_id()
    start_time = time.perf_counter()
    
    logger.info(f"Doc search request | query={request.query[:50]}...")
    
    try:
        response = await AgentRegistry.search_docs(query=request.query)
        
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        
        return DocSearchResponse(
            results=response.content,
            agent_name=response.agent_name,
            duration_ms=elapsed_ms
        )
        
    except Exception as e:
        logger.error(f"Doc search failed: {e}")
        raise to_http_error(e) from e


@router.get("/agents")
async def list_agents():
    """
    List available agents.
    """
    try:
        agents = AgentRegistry.list_agents()
        return {
            "agents": agents,
            "count": len(agents)
        }
    except Exception as e:
        logger.error(f"List agents failed: {e}")
        raise to_http_error(e) from e


@router.get("/health")
async def agent_health():
    """
    Check agent system health.
    """
    try:
        agents = AgentRegistry.list_agents()
        is_connected = len(agents) > 0
        return {
            "status": "healthy" if is_connected else "degraded",
            "foundry_connected": is_connected,
            "agents_discovered": len(agents),
            "agent_names": list(agents.keys())
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "foundry_connected": False,
            "error": str(e)
        }


@router.post("/initialize")
async def initialize_agents():
    """
    Initialize the agent registry.
    """
    try:
        await AgentRegistry.initialize()
        agents = AgentRegistry.list_agents()
        return {
            "status": "initialized",
            "agents": list(agents.keys())
        }
    except Exception as e:
        logger.error(f"Initialize failed: {e}")
        raise to_http_error(e) from e


# ==================== Diagram Schema (embedded) ====================

DIAGRAM_JSON_SCHEMA = '''You are an Azure architecture diagram generator. Return ONLY valid JSON (no markdown, no commentary) matching this exact schema:
{
  "nodes": [
    {
      "id": "group-<timestamp>-<random>",
      "type": "azure.group",
      "position": { "x": <number>, "y": <number> },
      "parentId": "<parent-group-id>" (optional, for nesting),
      "extent": "parent" (required when parentId is set),
      "data": {
        "title": "<display title>",
        "label": "<unique label>",
        "groupType": "region" | "subscription" | "resourceGroup",
        "region": "<azure-region>"
      }
    },
    {
      "id": "service-<timestamp>-<random>",
      "type": "azure.service",
      "position": { "x": <number>, "y": <number> },
      "parentId": "<resource-group-id>",
      "extent": "parent",
      "data": {
        "title": "<service title>",
        "label": "<unique label>",
        "resourceType": "<Azure resource type e.g. Microsoft.Web/sites>",
        "region": "<azure-region>",
        "resourceGroup": "<resource-group-name>",
        "properties": { <service-specific properties> }
      }
    }
  ],
  "edges": [
    {
      "id": "edge-<timestamp>-<random>",
      "source": "<source-node-id>",
      "target": "<target-node-id>",
      "type": "animated",
      "data": { "connectionType": "dependency" }
    }
  ]
}

Rules:
1. Nest nodes properly: Subscription inside Region, ResourceGroup inside Subscription, Services inside ResourceGroup.
2. Always set parentId and extent="parent" for nested nodes.
3. Use realistic positions (increment x/y to avoid overlap).
4. Use correct Azure resource types (Microsoft.Web/sites, Microsoft.KeyVault/vaults, etc.).
5. Return ONLY the JSON object, no markdown code fences, no explanation.'''


@router.post("/diagram/generate", response_model=DiagramFromPromptResponse)
async def generate_diagram_from_prompt(request: DiagramFromPromptRequest):
    """
    Generate an Azure architecture diagram from a natural language prompt.
    The JSON schema is embedded in the backend - users only provide a simple description.
    """
    set_correlation_id()
    start_time = time.perf_counter()
    
    logger.info(f"Diagram generation from prompt | len={len(request.prompt)}")
    
    try:
        # Build the full prompt with embedded schema
        full_prompt = f"{DIAGRAM_JSON_SCHEMA}\n\nUser request:\n{request.prompt}"
        
        # Call the iac_generator agent
        response = await AgentRegistry.chat(
            agent_type=AgentType.IAC_GENERATOR,
            message=full_prompt,
            context=None
        )
        
        # Extract JSON from response
        import re
        import json
        
        content = response.content.strip()
        
        # Remove markdown code fences if present
        if content.startswith("```"):
            # Find the end of the code block
            lines = content.split("\n")
            json_lines = []
            in_block = False
            for line in lines:
                if line.startswith("```") and not in_block:
                    in_block = True
                    continue
                elif line.startswith("```") and in_block:
                    break
                elif in_block:
                    json_lines.append(line)
            content = "\n".join(json_lines)
        
        # Try to parse as JSON
        try:
            diagram = json.loads(content)
        except json.JSONDecodeError:
            # Try to extract JSON object from the content
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                diagram = json.loads(json_match.group())
            else:
                raise ValueError("Could not parse diagram JSON from agent response")
        
        # Validate basic structure
        if "nodes" not in diagram or "edges" not in diagram:
            raise ValueError("Diagram must contain 'nodes' and 'edges' arrays")
        
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        
        return DiagramFromPromptResponse(
            diagram=diagram,
            agent_name=response.agent_name,
            duration_ms=elapsed_ms
        )
        
    except Exception as e:
        logger.error(f"Diagram generation failed: {e}")
        raise to_http_error(e) from e

