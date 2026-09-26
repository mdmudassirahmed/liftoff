"""Infrastructure as Code request and response models."""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class IaCFormat(str, Enum):
    """Supported IaC output formats."""
    BICEP = "bicep"
    TERRAFORM = "terraform"
    ARM = "arm"


class IaCRequest(BaseModel):
    """Request body for IaC generation endpoint."""
    architecture: Dict[str, Any] = Field(
        ...,
        description="Architecture diagram JSON from the frontend"
    )
    format: IaCFormat = Field(
        default=IaCFormat.BICEP,
        description="Output format: bicep, terraform, or arm"
    )
    include_comments: bool = Field(
        default=True,
        description="Include explanatory comments in generated code"
    )
    target_environment: Optional[str] = Field(
        default="development",
        description="Target environment: development, staging, production"
    )


class IaCResource(BaseModel):
    """A single generated resource."""
    resource_type: str = Field(..., description="Azure resource type")
    name: str = Field(..., description="Resource name")
    code: str = Field(..., description="Generated code for this resource")


class IaCResponse(BaseModel):
    """Response body from IaC generation endpoint."""
    code: str = Field(..., description="Complete generated IaC code")
    format: IaCFormat = Field(..., description="Output format used")
    resources: List[IaCResource] = Field(
        default=[],
        description="Individual resource details"
    )
    warnings: List[str] = Field(
        default=[],
        description="Any warnings or recommendations"
    )
    mcp_enhanced: bool = Field(
        default=False,
        description="Whether MCP was used for schema validation"
    )
    compliance: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Security guardrail compliance report (None when guardrails inactive)"
    )


class IaCValidateRequest(BaseModel):
    """Request body for IaC validation (matches the frontend client)."""
    code: str = Field(..., description="IaC code to validate")
    format: IaCFormat = Field(default=IaCFormat.BICEP, description="IaC format")


class IaCValidationResult(BaseModel):
    """Result of IaC validation."""
    valid: bool = Field(..., description="Whether the IaC is valid")
    errors: List[str] = Field(default=[], description="Validation errors")
    warnings: List[str] = Field(default=[], description="Validation warnings")
