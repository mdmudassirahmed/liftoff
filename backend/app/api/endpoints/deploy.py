"""
Deploy API endpoints.

Deploy Bicep/Terraform templates to Azure using Azure CLI.
Uses DefaultAzureCredential from the user's authenticated az cli session.
"""
import os
import re
import json
import tempfile
import subprocess
import asyncio
import shutil
from typing import List, Dict, Any, Optional, AsyncGenerator
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app.core.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


# ==================== Safety Helpers ====================

# Resolve the Azure CLI executable once. On Windows this is az.cmd/az.CMD; shutil.which
# honors PATHEXT and returns the full path, which lets us invoke with shell=False (no
# shell string parsing, so resource group names and paths can never be interpreted as
# shell metacharacters). Python 3.13 safely quotes arguments for .cmd targets.
_AZ_PATH: Optional[str] = None


def _resolve_az() -> str:
    """Return the full path to the Azure CLI executable, cached after first lookup."""
    global _AZ_PATH
    if _AZ_PATH is None:
        _AZ_PATH = shutil.which("az") or "az"
    return _AZ_PATH


def _safe_join(base_dir: str, rel_path: str) -> str:
    """Join a user-supplied relative path onto base_dir, refusing any path that escapes
    base_dir (absolute paths, drive letters, UNC roots, or .. traversal).

    Backslashes are treated as separators on every OS so Windows-style paths are
    judged the same way on a Linux host."""
    normalized = rel_path.replace("\\", "/")
    if (
        os.path.isabs(rel_path)
        or os.path.splitdrive(rel_path)[0]
        or normalized.startswith("/")
        or re.match(r"^[A-Za-z]:", normalized)
        or ".." in normalized.split("/")
    ):
        raise HTTPException(status_code=400, detail=f"Invalid file path: {rel_path}")
    rel_path = normalized
    base_real = os.path.normpath(base_dir)
    candidate = os.path.normpath(os.path.join(base_real, rel_path))
    if candidate != base_real and not candidate.startswith(base_real + os.sep):
        raise HTTPException(
            status_code=400,
            detail=f"File path escapes working directory: {rel_path}",
        )
    return candidate


# Values that end up as az CLI arguments are validated against Azure's own naming
# rules. shell=False already rules out shell injection; these checks also rule
# out argument injection (e.g. a resource group named "--query" or "-h").
_RESOURCE_GROUP_RE = re.compile(r"^[\w\-\.\(\)]{1,90}$")
_SUBSCRIPTION_ID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_LOCATION_RE = re.compile(r"^[a-zA-Z0-9]{1,40}$")
_MAX_FILES = 200
_MAX_FILE_CHARS = 2 * 1024 * 1024


def _validate_resource_group(value: str) -> str:
    if not _RESOURCE_GROUP_RE.match(value) or value.startswith("-") or value.endswith("."):
        raise ValueError(
            "Invalid resource group name: use 1-90 letters, digits, '_', '-', '.', '(' or ')', "
            "not starting with '-' or ending with '.'"
        )
    return value


def _validate_subscription_id(value: Optional[str]) -> Optional[str]:
    if value in (None, ""):
        return None
    if not _SUBSCRIPTION_ID_RE.match(value):
        raise ValueError("Invalid subscription ID: expected a GUID")
    return value


# ==================== Request/Response Models ====================

class DeploymentFile(BaseModel):
    """A file to deploy."""
    path: str = Field(..., min_length=1, max_length=260, description="Relative file path (e.g., main.bicep)")
    content: str = Field(..., max_length=_MAX_FILE_CHARS, description="File content")


class DeployRequest(BaseModel):
    """Request to deploy infrastructure."""
    files: List[DeploymentFile] = Field(..., max_length=_MAX_FILES, description="Files to deploy")
    resource_group: str = Field(..., description="Target Azure resource group name")
    subscription_id: Optional[str] = Field(None, description="Azure subscription ID (uses default if not provided)")
    parameters_file: Optional[str] = Field("parameters/dev.parameters.json", description="Parameters file path")
    location: str = Field("eastus", description="Azure region for deployment")
    dry_run: bool = Field(False, description="Validate without deploying (what-if)")

    @field_validator("resource_group")
    @classmethod
    def _check_resource_group(cls, v: str) -> str:
        return _validate_resource_group(v)

    @field_validator("subscription_id")
    @classmethod
    def _check_subscription(cls, v: Optional[str]) -> Optional[str]:
        return _validate_subscription_id(v)

    @field_validator("location")
    @classmethod
    def _check_location(cls, v: str) -> str:
        if not _LOCATION_RE.match(v):
            raise ValueError("Invalid location: expected an Azure region name such as 'eastus'")
        return v


class DeploymentOutput(BaseModel):
    """Deployment output."""
    name: str
    type: str
    value: Any


class DeploymentResource(BaseModel):
    """Deployed resource."""
    id: str
    resource_group: str


class DeployResponse(BaseModel):
    """Response from deployment."""
    success: bool
    deployment_name: str
    provisioning_state: str
    duration_seconds: float
    outputs: Dict[str, Any] = {}
    resources: List[DeploymentResource] = []
    correlation_id: Optional[str] = None
    error: Optional[str] = None
    warnings: List[str] = []


class DeployStatusResponse(BaseModel):
    """Response for deployment status check."""
    authenticated: bool
    subscription_id: Optional[str] = None
    subscription_name: Optional[str] = None
    user: Optional[str] = None
    tenant_id: Optional[str] = None
    error: Optional[str] = None


class WhatIfChange(BaseModel):
    """A single change in What-If result."""
    resource_id: str = Field(..., description="Azure resource ID")
    resource_type: str = Field("", description="Resource type (e.g., Microsoft.Web/sites)")
    resource_name: str = Field("", description="Resource name")
    change_type: str = Field(..., description="Create, Modify, Delete, NoChange, Ignore")
    before: Optional[Dict[str, Any]] = Field(None, description="Before state (for Modify/Delete)")
    after: Optional[Dict[str, Any]] = Field(None, description="After state (for Create/Modify)")
    delta: Optional[List[Dict[str, Any]]] = Field(None, description="Property changes")


class WhatIfResponse(BaseModel):
    """Response from What-If operation."""
    success: bool
    changes: List[WhatIfChange] = []
    summary: Dict[str, int] = Field(default_factory=dict, description="Count by change type")
    duration_seconds: float = 0
    error: Optional[str] = None
    warnings: List[str] = []


# ==================== Helper Functions ====================

def run_az_command_sync(args: List[str], cwd: Optional[str] = None) -> tuple[int, str, str]:
    """Run an Azure CLI command synchronously (works on Windows)."""
    try:
        cmd = [_resolve_az()] + args
        logger.info(f"Running: az {' '.join(args)}")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=cwd,
            shell=False  # Full az path resolved; no shell parsing of arguments.
        )

        return result.returncode, result.stdout, result.stderr
    except FileNotFoundError:
        logger.error("Azure CLI (az) not found on PATH")
        return 1, "", (
            "Azure CLI not found. Install it from "
            "https://learn.microsoft.com/cli/azure/install-azure-cli, then run 'az login' "
            "and restart the backend."
        )
    except Exception as e:
        logger.error(f"Error running az command: {e}", exc_info=True)
        return 1, "", str(e)


async def run_az_command(args: List[str], cwd: Optional[str] = None) -> tuple[int, str, str]:
    """Run an Azure CLI command (delegates to sync version via executor)."""
    import concurrent.futures
    
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as executor:
        return await loop.run_in_executor(
            executor,
            lambda: run_az_command_sync(args, cwd)
        )


async def check_az_auth() -> DeployStatusResponse:
    """Check if user is authenticated with Azure CLI."""
    returncode, stdout, stderr = await run_az_command(["account", "show", "-o", "json"])
    
    logger.info(f"az account show - returncode: {returncode}")
    if stderr:
        logger.warning(f"az account show - stderr: {stderr}")
    
    if returncode != 0:
        error_msg = stderr.strip() if stderr else "Not authenticated. Run 'az login' in your terminal first."
        return DeployStatusResponse(
            authenticated=False,
            error=error_msg
        )
    
    try:
        account = json.loads(stdout)
        logger.info(f"Authenticated as: {account.get('user', {}).get('name')} in subscription: {account.get('name')}")
        return DeployStatusResponse(
            authenticated=True,
            subscription_id=account.get("id"),
            subscription_name=account.get("name"),
            user=account.get("user", {}).get("name"),
            tenant_id=account.get("tenantId")
        )
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Azure CLI response: {e}, stdout: {stdout}")
        return DeployStatusResponse(
            authenticated=False,
            error="Failed to parse Azure CLI response"
        )


# ==================== API Endpoints ====================

@router.get("/status", response_model=DeployStatusResponse)
async def get_deploy_status():
    """
    Check Azure CLI authentication status.
    
    Returns current subscription, user, and tenant info.
    """
    try:
        return await check_az_auth()
    except Exception as e:
        logger.error(f"Error checking Azure CLI status: {e}", exc_info=True)
        return DeployStatusResponse(
            authenticated=False,
            error=f"Error checking Azure CLI: {str(e)}"
        )


@router.post("/logout")
async def logout_azure_cli():
    """Sign out from Azure CLI."""
    returncode, stdout, stderr = await run_az_command(["logout"])

    if returncode != 0:
        error_msg = stderr.strip() if stderr else "Failed to sign out from Azure CLI."
        raise HTTPException(status_code=500, detail=error_msg)

    return {"success": True, "message": "Signed out from Azure CLI."}


@router.get("/resource-groups", response_model=Dict[str, Any])
async def list_resource_groups(subscription_id: Optional[str] = None):
    """
    List available resource groups.
    
    Optionally filter by subscription ID.
    """
    try:
        subscription_id = _validate_subscription_id(subscription_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    auth_status = await check_az_auth()
    if not auth_status.authenticated:
        raise HTTPException(status_code=401, detail=auth_status.error)

    args = ["group", "list", "-o", "json"]
    if subscription_id:
        args.extend(["--subscription", subscription_id])
    
    returncode, stdout, stderr = await run_az_command(args)
    
    if returncode != 0:
        raise HTTPException(status_code=500, detail=f"Failed to list resource groups: {stderr}")
    
    try:
        groups = json.loads(stdout)
        return {
            "resource_groups": [
                {
                    "name": rg.get("name"),
                    "location": rg.get("location"),
                    "id": rg.get("id")
                }
                for rg in groups
            ],
            "subscription_id": subscription_id or auth_status.subscription_id
        }
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse resource groups response")


@router.get("/subscriptions", response_model=Dict[str, Any])
async def list_subscriptions():
    """
    List the Azure subscriptions the signed-in user can access (via `az account list`).

    Mirrors the resource-groups handler. Returns an empty list (never raises) when the
    user is not authenticated or the CLI is unavailable, so the canvas can fall back to
    manual entry without breaking today's behavior.
    """
    auth_status = await check_az_auth()
    if not auth_status.authenticated:
        # Soft failure: let the frontend keep its manual-entry fallback.
        return {"subscriptions": [], "authenticated": False, "error": auth_status.error}

    returncode, stdout, stderr = await run_az_command(
        ["account", "list", "--all", "-o", "json"]
    )

    if returncode != 0:
        logger.warning(f"Failed to list subscriptions: {stderr}")
        return {"subscriptions": [], "authenticated": True, "error": stderr.strip()}

    try:
        accounts = json.loads(stdout)
        subscriptions = [
            {
                "subscription_id": acct.get("id"),
                "name": acct.get("name"),
                "tenant_id": acct.get("tenantId"),
                "is_default": bool(acct.get("isDefault")),
                "state": acct.get("state"),
            }
            for acct in accounts
            # Only surface enabled subscriptions the user can actually deploy into.
            if acct.get("state", "Enabled") == "Enabled"
        ]
        # Default subscription first, then alphabetical for a stable dropdown order.
        subscriptions.sort(key=lambda s: (not s["is_default"], (s["name"] or "").lower()))
        return {
            "subscriptions": subscriptions,
            "authenticated": True,
            "default_subscription_id": auth_status.subscription_id,
        }
    except json.JSONDecodeError:
        logger.warning("Failed to parse subscriptions response")
        return {"subscriptions": [], "authenticated": True, "error": "Failed to parse subscriptions response"}


@router.post("/validate", response_model=DeployResponse)
async def validate_deployment(request: DeployRequest):
    """
    Validate deployment without actually deploying (what-if).
    
    This runs 'az deployment group what-if' to show what would change.
    """
    request.dry_run = True
    return await deploy(request)


@router.post("/what-if", response_model=WhatIfResponse)
async def what_if_deployment(request: DeployRequest):
    """
    Preview deployment changes using What-If operation.
    
    Returns a structured list of changes that would occur.
    """
    start_time = datetime.now()
    warnings = []
    
    # Check authentication
    auth_status = await check_az_auth()
    if not auth_status.authenticated:
        return WhatIfResponse(
            success=False,
            error=auth_status.error or "Not authenticated"
        )
    
    # Create temp directory for files
    temp_dir = tempfile.mkdtemp(prefix="liftoff-whatif-")
    logger.info(f"Created temp directory for what-if: {temp_dir}")
    
    try:
        # Write all files to temp directory
        main_bicep_path = None
        params_file_path = None
        
        for file in request.files:
            file_path = _safe_join(temp_dir, file.path)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)

            with open(file_path, "w", encoding="utf-8") as f:
                f.write(file.content)

            if file.path == "main.bicep":
                main_bicep_path = file_path
            if file.path == request.parameters_file:
                params_file_path = file_path

        if not main_bicep_path:
            return WhatIfResponse(
                success=False,
                error="main.bicep not found in files"
            )
        
        # Build what-if command
        args = [
            "deployment", "group", "what-if",
            "-g", request.resource_group,
            "-f", main_bicep_path,
            "-o", "json",
            "--no-pretty-print"
        ]
        
        if request.subscription_id:
            args.extend(["--subscription", request.subscription_id])
        
        if params_file_path and os.path.exists(params_file_path):
            args.extend(["-p", f"@{params_file_path}"])
        
        logger.info(f"Running what-if for resource group: {request.resource_group}")
        
        # Run what-if
        returncode, stdout, stderr = await run_az_command(args)
        
        duration = (datetime.now() - start_time).total_seconds()
        
        # Parse warnings
        if stderr:
            for line in stderr.split("\n"):
                if "Warning" in line:
                    warnings.append(line.strip())
        
        if returncode != 0:
            error_msg = stderr or stdout
            logger.error(f"What-if failed: {error_msg}")
            return WhatIfResponse(
                success=False,
                duration_seconds=duration,
                error=error_msg,
                warnings=warnings
            )
        
        # Parse what-if result
        try:
            result = json.loads(stdout)
            changes = []
            summary = {"Create": 0, "Modify": 0, "Delete": 0, "NoChange": 0, "Ignore": 0}
            
            # What-if result has "changes" array
            what_if_changes = result.get("changes", [])
            
            for change in what_if_changes:
                change_type = change.get("changeType", "Unknown")
                resource_id = change.get("resourceId", "")
                
                # Extract resource name and type from ID
                parts = resource_id.split("/")
                resource_name = parts[-1] if parts else ""
                resource_type = ""
                if "providers" in parts:
                    provider_idx = parts.index("providers")
                    if len(parts) > provider_idx + 2:
                        resource_type = f"{parts[provider_idx + 1]}/{parts[provider_idx + 2]}"
                
                # Count by type
                if change_type in summary:
                    summary[change_type] += 1
                
                changes.append(WhatIfChange(
                    resource_id=resource_id,
                    resource_type=resource_type,
                    resource_name=resource_name,
                    change_type=change_type,
                    before=change.get("before"),
                    after=change.get("after"),
                    delta=change.get("delta")
                ))
            
            return WhatIfResponse(
                success=True,
                changes=changes,
                summary=summary,
                duration_seconds=duration,
                warnings=warnings
            )
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse what-if response: {e}")
            return WhatIfResponse(
                success=False,
                duration_seconds=duration,
                error=f"Failed to parse what-if response: {str(e)}",
                warnings=warnings
            )
    
    finally:
        # Cleanup temp directory
        import shutil
        try:
            shutil.rmtree(temp_dir)
            logger.info(f"Cleaned up temp directory: {temp_dir}")
        except Exception as e:
            logger.warning(f"Failed to cleanup temp directory: {e}")


async def stream_what_if_logs(request: DeployRequest) -> AsyncGenerator[str, None]:
    """Generator that streams what-if operation logs as SSE events."""
    import shutil
    start_time = datetime.now()
    
    def send_event(event_type: str, data: dict) -> str:
        """Format SSE event."""
        return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    
    yield send_event("log", {"message": "Checking Azure authentication...", "step": "auth"})
    await asyncio.sleep(0.1)
    
    # Check authentication
    auth_status = await check_az_auth()
    if not auth_status.authenticated:
        yield send_event("error", {"message": f"Not authenticated: {auth_status.error}"})
        yield send_event("complete", {"success": False, "error": auth_status.error})
        return
    
    yield send_event("log", {"message": f"Authenticated as {auth_status.user}", "step": "auth"})
    yield send_event("log", {"message": f"Subscription: {auth_status.subscription_name}", "step": "auth"})
    await asyncio.sleep(0.2)
    
    # Create temp directory
    yield send_event("log", {"message": "Preparing deployment files...", "step": "prepare"})
    temp_dir = tempfile.mkdtemp(prefix="liftoff-whatif-stream-")
    
    try:
        # Write files
        main_bicep_path = None
        params_file_path = None
        file_count = 0
        
        for file in request.files:
            try:
                file_path = _safe_join(temp_dir, file.path)
            except HTTPException as e:
                yield send_event("error", {"message": f"{e.detail}"})
                yield send_event("complete", {"success": False, "error": e.detail})
                return
            os.makedirs(os.path.dirname(file_path), exist_ok=True)

            with open(file_path, "w", encoding="utf-8") as f:
                f.write(file.content)

            file_count += 1
            yield send_event("log", {"message": f"   Written: {file.path}", "step": "prepare"})
            
            if file.path == "main.bicep":
                main_bicep_path = file_path
            if file.path == request.parameters_file:
                params_file_path = file_path
        
        yield send_event("log", {"message": f"Prepared {file_count} files", "step": "prepare"})
        await asyncio.sleep(0.1)
        
        if not main_bicep_path:
            yield send_event("error", {"message": "main.bicep not found in files"})
            yield send_event("complete", {"success": False, "error": "main.bicep not found"})
            return
        
        # Build command
        yield send_event("log", {"message": f"Target: {request.resource_group}", "step": "analyze"})
        yield send_event("log", {"message": "Starting What-If analysis...", "step": "analyze"})
        yield send_event("log", {"message": "   This may take 30-60 seconds...", "step": "analyze"})
        await asyncio.sleep(0.2)
        
        args = [
            "deployment", "group", "what-if",
            "-g", request.resource_group,
            "-f", main_bicep_path,
            "-o", "json",
            "--no-pretty-print"
        ]
        
        if request.subscription_id:
            args.extend(["--subscription", request.subscription_id])
        
        if params_file_path and os.path.exists(params_file_path):
            args.extend(["-p", f"@{params_file_path}"])
        
        yield send_event("log", {"message": "Validating Bicep syntax...", "step": "validate"})
        await asyncio.sleep(0.3)
        yield send_event("log", {"message": "Connecting to Azure Resource Manager...", "step": "connect"})
        await asyncio.sleep(0.2)
        yield send_event("log", {"message": "Comparing with current state...", "step": "compare"})
        
        # Run what-if (this takes time)
        returncode, stdout, stderr = await run_az_command(args)
        
        duration = (datetime.now() - start_time).total_seconds()
        
        if returncode != 0:
            error_msg = stderr or stdout
            yield send_event("error", {"message": f"What-If failed: {error_msg[:200]}"})
            yield send_event("complete", {"success": False, "error": error_msg, "duration": duration})
            return
        
        yield send_event("log", {"message": "Analysis complete!", "step": "complete"})
        await asyncio.sleep(0.1)
        
        # Parse results
        try:
            result = json.loads(stdout)
            changes = []
            summary = {"Create": 0, "Modify": 0, "Delete": 0, "NoChange": 0, "Ignore": 0}
            
            what_if_changes = result.get("changes", [])
            
            yield send_event("log", {"message": f"Found {len(what_if_changes)} resource(s) to analyze", "step": "results"})
            await asyncio.sleep(0.1)
            
            for change in what_if_changes:
                change_type = change.get("changeType", "Unknown")
                resource_id = change.get("resourceId", "")
                
                parts = resource_id.split("/")
                resource_name = parts[-1] if parts else ""
                resource_type = ""
                if "providers" in parts:
                    provider_idx = parts.index("providers")
                    if len(parts) > provider_idx + 2:
                        resource_type = f"{parts[provider_idx + 1]}/{parts[provider_idx + 2]}"
                
                if change_type in summary:
                    summary[change_type] += 1
                
                # Emit each change as it's processed
                icon = {"Create": "+", "Modify": "~", "Delete": "-", "NoChange": "=", "Ignore": "x"}.get(change_type, "?")
                yield send_event("change", {
                    "resource_id": resource_id,
                    "resource_type": resource_type,
                    "resource_name": resource_name,
                    "change_type": change_type,
                    "icon": icon
                })
                
                changes.append({
                    "resource_id": resource_id,
                    "resource_type": resource_type,
                    "resource_name": resource_name,
                    "change_type": change_type
                })
                
                await asyncio.sleep(0.05)  # Small delay for visual effect
            
            # Summary
            yield send_event("log", {"message": "Summary:", "step": "summary"})
            if summary["Create"] > 0:
                yield send_event("log", {"message": f"   {summary['Create']} resource(s) to CREATE", "step": "summary"})
            if summary["Modify"] > 0:
                yield send_event("log", {"message": f"   {summary['Modify']} resource(s) to MODIFY", "step": "summary"})
            if summary["Delete"] > 0:
                yield send_event("log", {"message": f"   {summary['Delete']} resource(s) to DELETE", "step": "summary"})
            if summary["NoChange"] > 0:
                yield send_event("log", {"message": f"   {summary['NoChange']} resource(s) unchanged", "step": "summary"})
            
            yield send_event("log", {"message": f"Completed in {duration:.1f}s", "step": "complete"})
            
            yield send_event("complete", {
                "success": True,
                "changes": changes,
                "summary": summary,
                "duration": duration
            })
            
        except json.JSONDecodeError as e:
            yield send_event("error", {"message": f"Failed to parse response: {str(e)}"})
            yield send_event("complete", {"success": False, "error": str(e), "duration": duration})
    
    finally:
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass


@router.post("/what-if/stream")
async def what_if_stream(request: DeployRequest):
    """
    Stream What-If operation logs in real-time using Server-Sent Events.
    
    Returns a stream of events as the operation progresses.
    """
    return StreamingResponse(
        stream_what_if_logs(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/", response_model=DeployResponse)
async def deploy(request: DeployRequest):
    """
    Deploy Bicep templates to Azure.
    
    Uses the authenticated Azure CLI session.
    Files are written to a temp directory, deployed, then cleaned up.
    """
    start_time = datetime.now()
    warnings = []
    
    # Check authentication
    auth_status = await check_az_auth()
    if not auth_status.authenticated:
        raise HTTPException(status_code=401, detail=auth_status.error)
    
    # Create temp directory for files
    temp_dir = tempfile.mkdtemp(prefix="liftoff-deploy-")
    logger.info(f"Created temp directory: {temp_dir}")
    
    try:
        # Write all files to temp directory
        main_bicep_path = None
        params_file_path = None
        
        for file in request.files:
            file_path = _safe_join(temp_dir, file.path)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)

            with open(file_path, "w", encoding="utf-8") as f:
                f.write(file.content)

            logger.info(f"Written: {file.path}")
            
            # Track main.bicep and parameters file
            if file.path == "main.bicep":
                main_bicep_path = file_path
            if file.path == request.parameters_file:
                params_file_path = file_path
        
        if not main_bicep_path:
            raise HTTPException(status_code=400, detail="main.bicep not found in files")

        # Pre-compile Bicep to catch errors before attempting deployment.
        # Running az bicep build is much faster than az deployment group create
        # and surfaces compiler errors with line numbers immediately.
        logger.info("Running az bicep build pre-compile check...")
        build_rc, _build_out, build_err = await run_az_command(
            ["bicep", "build", "--file", main_bicep_path],
            cwd=temp_dir,
        )
        compiler_errors = [
            line.strip()
            for line in build_err.splitlines()
            if ": Error " in line and line.strip()
        ]
        if compiler_errors:
            error_detail = (
                "Bicep compilation failed. Regenerate the IaC and try again.\n\n"
                + "\n".join(compiler_errors)
            )
            logger.error(f"Bicep pre-compile failed with {len(compiler_errors)} error(s)")
            duration_so_far = (datetime.now() - start_time).total_seconds()
            return DeployResponse(
                success=False,
                deployment_name="pre-compile-check",
                provisioning_state="Failed",
                duration_seconds=duration_so_far,
                error=error_detail,
                warnings=[
                    line.strip()
                    for line in build_err.splitlines()
                    if "Warning" in line and line.strip()
                ],
            )
        logger.info("Bicep pre-compile passed - no compilation errors")

        # Build deployment command
        deployment_name = f"deploy-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        
        args = [
            "deployment", "group", "create" if not request.dry_run else "what-if",
            "-g", request.resource_group,
            "-f", main_bicep_path,
            "-n", deployment_name,
            "-o", "json"
        ]
        
        # Add subscription if specified
        if request.subscription_id:
            args.extend(["--subscription", request.subscription_id])
        
        # Add parameters file if it exists
        if params_file_path and os.path.exists(params_file_path):
            args.extend(["-p", f"@{params_file_path}"])
        
        logger.info(f"Deploying to resource group: {request.resource_group}")
        
        # Run deployment
        returncode, stdout, stderr = await run_az_command(args)
        
        duration = (datetime.now() - start_time).total_seconds()
        
        # Parse warnings from stderr
        if stderr:
            for line in stderr.split("\n"):
                if "Warning" in line:
                    warnings.append(line.strip())
        
        if returncode != 0:
            error_msg = stderr or stdout
            logger.error(f"Deployment failed: {error_msg}")
            return DeployResponse(
                success=False,
                deployment_name=deployment_name,
                provisioning_state="Failed",
                duration_seconds=duration,
                error=error_msg,
                warnings=warnings
            )
        
        # Parse successful response
        try:
            result = json.loads(stdout)
            
            # For what-if, result format is different
            if request.dry_run:
                return DeployResponse(
                    success=True,
                    deployment_name=deployment_name,
                    provisioning_state="WhatIf",
                    duration_seconds=duration,
                    outputs={"what_if_result": result},
                    warnings=warnings
                )
            
            properties = result.get("properties", {})
            
            # Extract outputs
            outputs = {}
            for key, val in properties.get("outputs", {}).items():
                outputs[key] = val.get("value")
            
            # Extract resources
            resources = [
                DeploymentResource(
                    id=r.get("id", ""),
                    resource_group=r.get("resourceGroup", "")
                )
                for r in properties.get("outputResources", [])
            ]
            
            return DeployResponse(
                success=True,
                deployment_name=result.get("name", deployment_name),
                provisioning_state=properties.get("provisioningState", "Unknown"),
                duration_seconds=duration,
                outputs=outputs,
                resources=resources,
                correlation_id=properties.get("correlationId"),
                warnings=warnings
            )
            
        except json.JSONDecodeError:
            return DeployResponse(
                success=True,
                deployment_name=deployment_name,
                provisioning_state="Succeeded",
                duration_seconds=duration,
                warnings=warnings
            )
    
    finally:
        # Cleanup temp directory
        import shutil
        try:
            shutil.rmtree(temp_dir)
            logger.info(f"Cleaned up temp directory: {temp_dir}")
        except Exception as e:
            logger.warning(f"Failed to cleanup temp directory: {e}")
