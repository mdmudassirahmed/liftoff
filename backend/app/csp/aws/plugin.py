"""AWS plugin - generates CloudFormation with the AWS IaC generator agent."""
import asyncio
from typing import Any, Dict

from app.csp.base import AbstractCSPPlugin
from app.csp.aws.prompt import build_aws_iac_prompt
from app.csp.aws.postprocess import postprocess_cloudformation
from app.core.logging import get_logger

logger = get_logger(__name__)

_AWS_AGENT_TYPE = "aws_iac_generator"


class AWSCSPPlugin(AbstractCSPPlugin):
    """AWS CloudFormation generation."""

    @property
    def csp_name(self) -> str:
        return "aws"

    @property
    def default_iac_format(self) -> str:
        return "cloudformation"

    def get_supported_formats(self) -> list[str]:
        return ["cloudformation"]

    async def generate_iac(
        self,
        architecture: Dict[str, Any],
        fmt: str,
        modular: bool = False,
    ) -> Dict[str, Any]:
        """Generate CloudFormation YAML with the AWS IaC generator agent."""
        from app.agents.foundry import AgentRegistry

        prompt = build_aws_iac_prompt(architecture)
        try:
            response = await AgentRegistry.chat(
                agent_type=_AWS_AGENT_TYPE,
                message=prompt,
                context=architecture,
            )
            raw_template = response.content
        except Exception as e:
            logger.warning(
                f"AWS IaC generator unavailable ({e}); "
                "falling back to direct orchestrator call"
            )
            # Fallback: use orchestrator agent with AWS context
            response = await AgentRegistry.chat(
                agent_type="orchestrator",
                message=f"Generate AWS CloudFormation YAML for this architecture:\n{prompt}",
                context=architecture,
            )
            raw_template = response.content

        # Deterministic post-processing
        template = postprocess_cloudformation(raw_template)

        # Validate with cfn-lint (when installed) and send errors back for one
        # correction round - the CloudFormation counterpart of the Bicep compile loop.
        from app.csp.aws.deploy import _lint_template

        errors = await asyncio.get_event_loop().run_in_executor(None, _lint_template, template)
        if errors:
            logger.info(f"cfn-lint found {len(errors)} error(s); requesting a correction")
            try:
                fix = await AgentRegistry.chat(
                    agent_type=_AWS_AGENT_TYPE,
                    message=(
                        "This CloudFormation template fails cfn-lint with the errors below. "
                        "Fix ONLY these errors and return the complete corrected template as YAML, "
                        "with no markdown fences.\n\nERRORS:\n" + "\n".join(errors[:25])
                        + "\n\nTEMPLATE:\n" + template
                    ),
                )
                fixed = postprocess_cloudformation(fix.content)
                remaining = await asyncio.get_event_loop().run_in_executor(None, _lint_template, fixed)
                if len(remaining) < len(errors):
                    template = fixed
                    logger.info(f"cfn-lint correction applied | remaining_errors={len(remaining)}")
            except Exception as e:  # noqa: BLE001 - keep the first template on any failure
                logger.warning(f"cfn-lint correction skipped: {e}")

        agent_name = getattr(response, "agent_name", "aws-iac-generator-agent")

        if modular:
            from app.csp.aws.modularize import split_cloudformation
            files = split_cloudformation(template)
            module_files = [f for f in files if f["path"].startswith("modules/")]
            categories = sorted({f["path"].split("/")[1] for f in module_files})
            summary = (
                f"{len(module_files)} module(s) across {len(categories)} category/ies: "
                f"{', '.join(categories)}"
                if module_files else "Consolidated CloudFormation template"
            )
            return {
                "files": files,
                "format": "cloudformation",
                "agent_name": agent_name,
                "structure_summary": summary,
            }

        return {
            "template": template,
            "format": "cloudformation",
            "agent_name": agent_name,
        }
