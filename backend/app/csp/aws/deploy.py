"""
AWS CloudFormation deploy via boto3 change-set.
Flow: cfn-lint gate -> account allowlist check -> create_change_set -> execute ->
poll describe_stack_events until terminal state.
"""
import asyncio
import time
import uuid
from typing import Any, Dict, List, Optional

from app.core.logging import get_logger
from app.core.config import get_settings

settings = get_settings()

logger = get_logger(__name__)

# In-memory server-side session store: {iac_session_id -> template_yaml}
_SESSION_STORE: Dict[str, str] = {}

# Terminal CloudFormation stack states
_TERMINAL_STATES = {
    "CREATE_COMPLETE", "CREATE_FAILED",
    "UPDATE_COMPLETE", "UPDATE_FAILED",
    "DELETE_COMPLETE", "DELETE_FAILED",
    "ROLLBACK_COMPLETE", "ROLLBACK_FAILED",
    "UPDATE_ROLLBACK_COMPLETE", "UPDATE_ROLLBACK_FAILED",
}

_STS_REFRESH_INTERVAL_S = 50 * 60  # 50 minutes


def store_template(template_yaml: str) -> str:
    """Store a CF template server-side, return an opaque session ID."""
    session_id = str(uuid.uuid4())
    _SESSION_STORE[session_id] = template_yaml
    return session_id


def retrieve_template(session_id: str) -> Optional[str]:
    """Retrieve a stored CF template by session ID. Returns None if not found."""
    return _SESSION_STORE.get(session_id)


def _lint_template(template_yaml: str) -> List[str]:
    """
    Run cfn-lint on the template. Returns list of error messages.
    Empty list means no errors. Non-fatal warnings are excluded.
    Requires cfn-lint to be installed (pip install cfn-lint).
    """
    try:
        from cfnlint.api import lint  # cfn-lint v1 public API: runs every rule
    except ImportError:
        logger.warning("cfn-lint not installed; skipping pre-deploy lint gate")
        return []
    try:
        matches = lint(template_yaml)
        # Errors (E*) always block; these warnings are treated as blocking too:
        # W3037 IAM permission issues, W1020 unnecessary Fn::Sub.
        blocking = [m for m in matches if m.rule.id.startswith("E") or m.rule.id in ("W3037", "W1020")]
        return sorted({f"{m.rule.id}: {m.message} (line {m.linenumber})" for m in blocking})
    except ImportError:
        logger.warning("cfn-lint not installed; skipping pre-deploy lint gate")
        return []
    except Exception as e:
        logger.warning(f"cfn-lint failed: {e}; proceeding without lint gate")
        return []


def _get_boto3_client(service: str, session_context: Optional[Dict] = None, region: Optional[str] = None):
    """
    Return a boto3 client. Supports profile, assume-role, and direct credentials.
    STS token refresh is handled at the call site via _get_fresh_session().
    """
    try:
        import boto3
        from botocore.config import Config

        config = Config(region_name=region or settings.AWS_DEFAULT_REGION)

        if settings.AWS_ASSUME_ROLE_ARN:
            sts = boto3.client("sts", config=config)
            if settings.AWS_PROFILE:
                import boto3.session as bs
                sts = bs.Session(profile_name=settings.AWS_PROFILE).client("sts", config=config)
            assumed = sts.assume_role(
                RoleArn=settings.AWS_ASSUME_ROLE_ARN,
                RoleSessionName="LiftoffDeploy",
                DurationSeconds=3600,
            )
            creds = assumed["Credentials"]
            return boto3.client(
                service,
                aws_access_key_id=creds["AccessKeyId"],
                aws_secret_access_key=creds["SecretAccessKey"],
                aws_session_token=creds["SessionToken"],
                config=config,
            )
        elif settings.AWS_PROFILE:
            import boto3.session as bs
            return bs.Session(profile_name=settings.AWS_PROFILE).client(service, config=config)
        else:
            return boto3.client(service, config=config)
    except Exception as e:
        raise RuntimeError(f"Failed to create boto3 {service} client: {e}") from e


def _check_account_allowlist(cfn_client) -> None:
    """Verify the AWS account is in the configured allowlist."""
    allowed = [
        a.strip()
        for a in (settings.AWS_ALLOWED_ACCOUNT_IDS or "").split(",")
        if a.strip()
    ]
    if not allowed:
        return  # No allowlist configured - skip check
    try:
        sts = _get_boto3_client("sts")
        account_id = sts.get_caller_identity()["Account"]
        if account_id not in allowed:
            raise PermissionError(
                f"AWS account {account_id} is not in the allowed list. "
                f"Contact your administrator to add it."
            )
    except PermissionError:
        raise
    except Exception as e:
        logger.warning(f"Account allowlist check failed: {e}; proceeding")


async def deploy_cloudformation(
    *,
    iac_session_id: Optional[str] = None,
    template_yaml: Optional[str] = None,
    stack_name: str,
    parameters: Optional[List[Dict[str, str]]] = None,
    region: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Deploy a CloudFormation template using the change-set pattern.

    Either iac_session_id (to retrieve a stored template) or template_yaml
    must be provided. Session ID is preferred for production use.

    Returns dict with: stack_name, status, events (list), change_set_id.
    Raises on lint failures, account allowlist violations, or stack failures.
    """
    # Retrieve template
    if iac_session_id:
        template_yaml = retrieve_template(iac_session_id)
        if not template_yaml:
            raise ValueError(f"No template found for session {iac_session_id}")
    if not template_yaml:
        raise ValueError("template_yaml or iac_session_id required")

    # cfn-lint pre-deploy gate
    lint_errors = _lint_template(template_yaml)
    if lint_errors:
        raise ValueError(
            f"CloudFormation template failed lint checks ({len(lint_errors)} errors):\n"
            + "\n".join(f"  - {e}" for e in lint_errors[:10])
        )

    # Run deploy in thread pool (boto3 is synchronous)
    return await asyncio.get_event_loop().run_in_executor(
        None,
        _deploy_sync,
        template_yaml,
        stack_name,
        parameters or [],
        region,
    )


def _deploy_sync(
    template_yaml: str,
    stack_name: str,
    parameters: List[Dict[str, str]],
    region: Optional[str] = None,
) -> Dict[str, Any]:
    """Synchronous deploy: create_change_set -> execute -> poll events."""
    cfn = _get_boto3_client("cloudformation", region=region)
    _check_account_allowlist(cfn)

    change_set_name = f"liftoff-{int(time.time())}"
    t0 = time.time()

    # Determine if stack exists
    try:
        cfn.describe_stacks(StackName=stack_name)
        change_set_type = "UPDATE"
    except Exception:
        change_set_type = "CREATE"

    # Create change set
    try:
        cs = cfn.create_change_set(
            StackName=stack_name,
            TemplateBody=template_yaml,
            ChangeSetName=change_set_name,
            ChangeSetType=change_set_type,
            Parameters=parameters,
            Capabilities=["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM", "CAPABILITY_AUTO_EXPAND"],
        )
        change_set_id = cs.get("Id", change_set_name)
    except Exception as e:
        raise RuntimeError(f"create_change_set failed: {e}") from e

    # Wait for change set to be ready
    for _ in range(60):
        time.sleep(5)
        try:
            cs_desc = cfn.describe_change_set(
                ChangeSetName=change_set_name,
                StackName=stack_name,
            )
            status = cs_desc.get("Status", "")
            if status == "CREATE_COMPLETE":
                break
            if status in ("FAILED", "DELETE_COMPLETE"):
                reason = cs_desc.get("StatusReason", "Unknown")
                if "didn't contain changes" in reason.lower():
                    return {
                        "stack_name": stack_name,
                        "status": "NO_CHANGES",
                        "change_set_id": change_set_id,
                        "events": [],
                        "message": "No changes to deploy",
                    }
                raise RuntimeError(f"Change set failed: {reason}")
        except RuntimeError:
            raise
        except Exception:
            pass
    else:
        raise RuntimeError("Change set did not become ready within 5 minutes")

    # Execute change set
    cfn.execute_change_set(
        ChangeSetName=change_set_name,
        StackName=stack_name,
    )

    # Poll stack events until terminal state
    events = []
    last_event_id = None
    sts_refresh_t = time.time()

    while True:
        time.sleep(10)

        # STS token refresh if approaching expiry
        if time.time() - sts_refresh_t > _STS_REFRESH_INTERVAL_S:
            cfn = _get_boto3_client("cloudformation")
            sts_refresh_t = time.time()

        try:
            stacks = cfn.describe_stacks(StackName=stack_name)["Stacks"]
            if not stacks:
                break
            current_status = stacks[0].get("StackStatus", "")

            # Collect new events since T0
            new_events = []
            paginator = cfn.get_paginator("describe_stack_events")
            for page in paginator.paginate(StackName=stack_name):
                for ev in page["StackEvents"]:
                    ev_time = ev.get("Timestamp")
                    ev_id = ev.get("EventId")
                    if ev_id == last_event_id:
                        break
                    if ev_time and ev_time.timestamp() >= t0:
                        new_events.append({
                            "resource": ev.get("LogicalResourceId", ""),
                            "type": ev.get("ResourceType", ""),
                            "status": ev.get("ResourceStatus", ""),
                            "reason": ev.get("ResourceStatusReason", ""),
                            "timestamp": str(ev_time),
                        })
                else:
                    continue
                break
            if new_events:
                last_event_id = new_events[0].get("EventId") if new_events else last_event_id
                events = new_events + events

            if current_status in _TERMINAL_STATES:
                failed = any(
                    s in current_status for s in ("FAILED", "ROLLBACK")
                )
                if failed:
                    raise RuntimeError(
                        f"Stack deployment failed with status {current_status}. "
                        f"Check CloudFormation events for details."
                    )
                return {
                    "stack_name": stack_name,
                    "status": current_status,
                    "change_set_id": change_set_id,
                    "events": events[:50],  # cap for response size
                }
        except RuntimeError:
            raise
        except Exception as e:
            logger.warning(f"Poll error: {e}")
