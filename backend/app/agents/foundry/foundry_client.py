"""
Azure AI Foundry Client using SDK.

Uses azure-ai-projects SDK which handles authentication correctly.
The SDK knows the correct token scope for AI Foundry endpoints.

Direct HTTP would require knowing the exact token audience,
which can vary by service. SDK handles this automatically.
"""
import asyncio
import json
import re
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient

from app.agents.prompts import AGENTS, SYSTEM_PROMPTS
from app.agents.providers import (
    FOUNDRY,
    NONE,
    ChatProvider,
    build_provider,
    not_configured_message,
    resolve_provider_kind,
)
from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)
settings = get_settings()


# Emoji / pictographic icon ranges. Box-drawing characters (U+2500-257F) used for
# folder-tree diagrams are deliberately NOT included, so tree structures survive.
_EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"  # supplementary pictographs, emoji, symbols
    "☀-➿"          # misc symbols + dingbats (checks, stars, arrows-as-icons)
    "⬀-⯿"          # misc symbols and arrows
    "️‍"           # emoji variation selector + zero-width joiner
    "]",
    flags=re.UNICODE,
)


def _strip_icons(text: str) -> str:
    """Remove emoji/decorative icons from generated docs (enterprise plain text).

    Applied to README / markdown only. Leaves code, box-drawing tree diagrams,
    and normal punctuation intact. Fail-safe: returns input on any error.
    """
    try:
        if not text:
            return text
        cleaned = _EMOJI_RE.sub("", text)
        # Tidy artefacts left where a leading icon was removed.
        cleaned = re.sub(r"(?m)^(#{1,6})[ \t]{2,}", r"\1 ", cleaned)   # "##  Title" -> "## Title"
        cleaned = re.sub(r"(?m)^([-*])[ \t]{2,}", r"\1 ", cleaned)     # "-  item"   -> "- item"
        cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)                    # collapse leftover runs
        return cleaned
    except Exception:  # noqa: BLE001 - cosmetic, never break generation
        return text


def _fix_bicep_syntax(code: str) -> str:
    """Auto-correct the most common LLM-generated Bicep syntax mistakes.

    Applied to every Bicep template before it leaves the backend so the user
    never has to deal with compilation errors from known LLM patterns.

    Fail-safe: returns the original code on any unexpected error.
    """
    try:
        if not code or not code.strip():
            return code

        lines = code.splitlines()
        out: List[str] = []
        i = 0

        while i < len(lines):
            line = lines[i]

            # --- Fix 1: inline decorator on same line as param ---
            # Wrong: param foo string = 'x' @description('...')
            # Right: @description('...')\nparam foo string = 'x'
            # Decorators appearing AFTER a param declaration on the same line.
            inline_dec = re.search(r'(\s)(@(?:description|allowed|secure|minLength|maxLength|minValue|maxValue)\s*\([^)]*\))', line)
            if inline_dec and re.match(r'\s*param\s+', line):
                before = line[:inline_dec.start(1)].rstrip()
                decorator = inline_dec.group(2)
                # Reconstruct: decorator on previous position, param on next
                indent = re.match(r'^(\s*)', line).group(1)
                out.append(f"{indent}{decorator}")
                out.append(before)
                i += 1
                continue

            # --- Fix 2: optional param suffix (?) ---
            # Wrong: param foo string?
            # Right: param foo string
            # Also handles: param foo string? = 'default'
            if re.match(r'\s*param\s+', line):
                line = re.sub(r'(\bparam\s+\w+\s+\w+)\?', r'\1', line)

            # --- Fix 3: decorator placed after param type on same line (alternative pattern) ---
            # Wrong: param location string @description('...')
            # Right: @description('...')\nparam location string
            dec_after_type = re.match(r'^(\s*param\s+\w+\s+\w[\w\[\]{}]*)\s+(@(?:description|allowed|secure|minLength|maxLength)\s*\([^)]*\))\s*$', line)
            if dec_after_type:
                indent = re.match(r'^(\s*)', line).group(1)
                out.append(f"{indent}{dec_after_type.group(2)}")
                out.append(dec_after_type.group(1))
                i += 1
                continue

            out.append(line)
            i += 1

        fixed = "\n".join(out)

        # --- Fix 4: Remove enableHttpsTrafficOnly from CognitiveServices (BCP037) ---
        # This is a Storage Account property; it does not exist on CognitiveServices/accounts.
        if "Microsoft.CognitiveServices/accounts" in fixed:
            fixed = re.sub(r"\n[ \t]*enableHttpsTrafficOnly\s*:.*", "", fixed)

        # --- Fix 5: Application_Type case sensitivity for App Insights (BCP089) ---
        # Wrong: application_Type: 'web'
        # Right: Application_Type: 'web'
        fixed = re.sub(r"\bapplication_Type\b", "Application_Type", fixed)

        # --- Fix 6: Remove virtualNetworkSubnetId from inside siteConfig (BCP037) ---
        # virtualNetworkSubnetId belongs at site properties level, not inside siteConfig.
        # When no VNet node is in the diagram, strip it entirely.
        fixed = re.sub(r"\n[ \t]*virtualNetworkSubnetId\s*:.*", "", fixed)

        if fixed != code:
            logger.info("[BicepFix] Applied syntax corrections to generated template")

        return fixed
    except Exception:  # noqa: BLE001 - cosmetic post-processor, never break generation
        return code


# Correction hint injected when the LLM-generated Bicep has compilation errors.
# Kept as a module-level constant so it's easy to update without touching the method.
_BICEP_FIX_HINT = """
CRITICAL CORRECTIONS FOR ROLE ASSIGNMENTS (the most common source of BCP120/BCP036):

1. Resource names MUST be computed as vars in main.bicep from params only - NEVER from module outputs.
   CORRECT:  var storageAccountName = '${namePrefix}storage'
   WRONG:    storageAccount.outputs.name  (module output)

2. 'existing' resource declarations MUST use the var from step 1 - NOT module outputs:
   CORRECT:  resource storageRef '...' existing = {{ name: storageAccountName }}
   WRONG:    resource storageRef '...' existing = {{ name: storageAccount.outputs.name }}

3. Role assignment name MUST use only deployment-start vars:
   CORRECT:  name: guid(namePrefix, storageAccountName, 'StorageBlobDataContributor')
   WRONG:    name: guid(storageAccount.outputs.id, ...)
   WRONG:    name: guid(functionAppPrincipalId, ...)

4. Role assignment scope MUST be the 'existing' resource reference:
   CORRECT:  scope: storageRef
   WRONG:    scope: storageAccount.outputs.resourceId  (string)

5. siteConfig MUST be INSIDE properties, never at resource root:
   CORRECT:  properties: {{ siteConfig: {{ ... }} }}
   WRONG:    properties: {{ ... }} siteConfig: {{ ... }}   (BCP037)

6. String interpolation, not concatenation:
   CORRECT:  'https://${{hostname}}'
   WRONG:    'https://' + hostname   (BCP045)

7. Key Vault MUST include tenantId in properties:
   properties: {{ tenantId: tenantId, sku: {{ name: 'standard', family: 'A' }}, ... }}

Fix ONLY the listed errors. Return the corrected JSON with all files intact.
"""


# Static generation rules for single-file IaC. Kept as a plain (non f-) string
# so Bicep braces and ${...} interpolations never need escaping.
_SINGLE_FILE_RULES = """BICEP SYNTAX RULES (MUST FOLLOW - VIOLATIONS CAUSE DEPLOYMENT FAILURE):
- Decorators (@description, @allowed, @secure) MUST be on the line BEFORE the param
- @allowed must be a single inline array: @allowed(['dev', 'tst', 'prd'])
- Optional params: use a default value (param foo string = ''), NEVER the ? suffix
- NO unnecessary string interpolation: use kind: kind NOT kind: '${kind}'
- Every declared parameter MUST be used - remove any param that is not referenced anywhere
- Templates target resource group scope (default) - NO targetScope = 'subscription'
- For User-Assigned Managed Identity: identity.type = 'UserAssigned', DO NOT output resource.identity.principalId
- NO utcNow() in param defaults - only valid inside resource property expressions
- Do NOT generate subnetResourceId/existingSubnetResourceId unless the diagram has a VNet node

API VERSIONS (use these exactly - 2023-12-01 lacks local type definitions):
  Microsoft.Storage/storageAccounts: 2022-09-01
  Microsoft.KeyVault/vaults: 2023-02-01
  Microsoft.Insights/components: 2020-02-02
  Microsoft.Web/sites: 2022-09-01
  Microsoft.Web/serverfarms: 2022-09-01
  Microsoft.Authorization/roleAssignments: 2022-04-01
  Microsoft.OperationalInsights/workspaces: 2022-10-01
  Microsoft.CognitiveServices/accounts: 2023-05-01
  Microsoft.Search/searchServices: 2023-11-01
  All other types: use a 2022 or 2023 version (not 2023-12-01)

COGNITIVE SERVICES FORBIDDEN PROPERTIES (BCP037):
  Do NOT use enableHttpsTrafficOnly on Microsoft.CognitiveServices/accounts - it is a Storage property.
  WRONG: properties: { enableHttpsTrafficOnly: true }
  CORRECT: properties: { disableLocalAuth: true, networkAcls: { defaultAction: 'Deny' } }

NO UNNECESSARY dependsOn (BCP lint warning):
  Bicep infers dependencies from symbolic name references automatically.
  Remove dependsOn entries when the resource is already referenced in properties.
  WRONG: dependsOn: [appService]  // when properties already use appService.id
  CORRECT: Omit dependsOn - Bicep handles implicit dependencies.

NO HARDCODED AZURE ENVIRONMENT URLs (no-hardcoded-env-urls):
  WRONG: '${storageAccountName}.blob.core.windows.net'
  CORRECT: '${storageAccountName}.blob.${environment().suffixes.storage}'

STORAGE ACCOUNT NAMES MUST BE GLOBALLY UNIQUE:
  WRONG: var storageAccountName = '${namePrefix}storage'  // "demostorage" will be taken
  CORRECT: var storageAccountName = '${toLower(namePrefix)}st${uniqueString(resourceGroup().id)}'

Application_Type IS CASE-SENSITIVE for App Insights (BCP089):
  WRONG: application_Type: 'web'   // lowercase a - causes BCP089
  CORRECT: Application_Type: 'web' // capital A required

ROLE ASSIGNMENT RULES (BCP120 / BCP036 - the most common deployment error):
  name: MUST use only deployment-start-evaluable values.
    CORRECT: name: guid(namePrefix, storageAccountName, 'StorageBlobDataContributor')
    WRONG:   name: guid(principalId, storageAccount.id, ...)  // runtime values
  scope: MUST be a resource symbolic name, never a string.
    CORRECT: scope: storageAccount  (direct resource reference in same file)
    WRONG:   scope: storageAccount.id  // string - causes BCP036

Return JSON with: code, resources, parameters, warnings, deployment_instructions"""


def _extract_bicep_errors(stderr: str) -> List[str]:
    """Extract only ERROR lines from az bicep build stderr (not warnings)."""
    return [
        line.strip()
        for line in stderr.splitlines()
        if ": Error " in line and line.strip()
    ]


async def _validate_bicep_files(
    files: List[Dict[str, Any]],
) -> List[str]:
    """Run az bicep build on a set of files and return any compilation ERROR lines.

    Writes files to a temp dir, runs `az bicep build --file main.bicep`,
    then cleans up. Returns an empty list on any infrastructure failure
    (missing az/bicep CLI, temp-dir error) so callers degrade gracefully.
    """
    import os
    import shutil
    import subprocess
    import tempfile

    _logger = get_logger(__name__)
    az_path = shutil.which("az") or "az"
    temp_dir: Optional[str] = None

    try:
        temp_dir = tempfile.mkdtemp(prefix="liftoff-bicep-validate-")
        main_path: Optional[str] = None

        for f in files:
            rel = f.get("path", "")
            content = f.get("content", "")
            if not rel.endswith(".bicep"):
                continue
            full = os.path.normpath(os.path.join(temp_dir, rel))
            # path-traversal guard (same as deploy.py _safe_join)
            if os.path.isabs(rel) or not full.startswith(os.path.normpath(temp_dir) + os.sep):
                continue
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fp:
                fp.write(content)
            if rel == "main.bicep":
                main_path = full

        if not main_path:
            return []

        result = subprocess.run(
            [az_path, "bicep", "build", "--file", main_path],
            capture_output=True,
            text=True,
            cwd=temp_dir,
            timeout=60,
        )
        errors = _extract_bicep_errors(result.stderr)
        if errors:
            _logger.warning(f"[BicepValidate] {len(errors)} compiler error(s) detected")
        else:
            _logger.info("[BicepValidate] Bicep templates compiled without errors")
        return errors

    except Exception as exc:  # noqa: BLE001 - fail-safe
        _logger = get_logger(__name__)
        _logger.debug(f"[BicepValidate] Validation skipped: {exc}")
        return []
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)


# Agent names in Azure AI Foundry (created by scripts/foundry_agents.py)
AGENT_NAMES = {agent_type: spec["name"] for agent_type, spec in AGENTS.items()}


class AgentsUnavailableError(RuntimeError):
    """Raised when an AI feature is used but Azure AI Foundry is not configured
    or not reachable. Mapped to HTTP 503 by the API layer."""


@dataclass
class AgentResponse:
    """Response from an agent."""
    content: str
    agent_name: str
    agent_type: str
    sources: Optional[List[str]] = None
    grounding: Optional[str] = None  # e.g. "microsoft-learn-mcp"


def _grounding_query(message: str) -> str:
    """The user's actual question: long composed prompts end with it."""
    text = (message or "").strip()
    if len(text) <= 400:
        return text
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    last = lines[-1] if lines else text
    for prefix in ("User Question:", "User:", "Question:"):
        if last.startswith(prefix):
            last = last[len(prefix):].strip()
    return last[:400]


def _is_aws_context(context: Optional[Dict[str, Any]]) -> bool:
    arch = (context or {}).get("architecture")
    if not isinstance(arch, dict):
        return False
    from app.services.guardrails import detect_cloud

    return detect_cloud(arch) == "AWS"


class FoundryClient:
    """
    Client for calling Azure AI Foundry agents.
    
    Uses azure-ai-projects SDK because:
    1. Handles authentication correctly (knows the right token scope)
    2. Manages token refresh automatically
    3. Has built-in retry logic
    
    The call is still simple - we just call the agent by name.
    """
    
    _instance: Optional['FoundryClient'] = None
    
    def __new__(cls):
        """Singleton pattern."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if getattr(self, '_initialized', False):
            return
            
        self._project_client: Optional[AIProjectClient] = None
        self._openai_client = None
        self._credential: Optional[DefaultAzureCredential] = None
        self._provider: Optional[ChatProvider] = None   # non-Foundry chat model
        self._provider_error: Optional[str] = None
        self._agents_cache: Dict[str, Any] = {}
        self._initialized = False
    
    @property
    def project_endpoint(self) -> str:
        """Get the project endpoint from settings."""
        return settings.AZURE_AI_PROJECT_ENDPOINT
    
    @property
    def is_initialized(self) -> bool:
        """Check if client is initialized."""
        return self._initialized and self._project_client is not None
    
    async def initialize(self) -> bool:
        """Initialize the AI client: a chat provider, or the Foundry agent client."""
        if self._initialized:
            return True

        kind = resolve_provider_kind()
        if kind == NONE:
            logger.warning(not_configured_message())
            return False
        if kind != FOUNDRY:
            try:
                self._provider = build_provider()
            except Exception as e:  # noqa: BLE001 - surfaced to the caller as 503
                logger.error(f"AI provider setup failed: {e}")
                self._provider_error = str(e)
                return False
            self._agents_cache = {
                agent_type: {"name": name, "provider": self._provider.name, "model": self._provider.model}
                for agent_type, name in AGENT_NAMES.items()
            }
            self._initialized = True
            logger.info(f"AI ready | provider={self._provider.name} | model={self._provider.model}")
            return True

        try:
            endpoint = self.project_endpoint
            if not endpoint:
                logger.error("AZURE_AI_PROJECT_ENDPOINT not configured")
                return False
            
            logger.info(f"Initializing FoundryClient with endpoint: {endpoint[:60]}...")
            
            # Create credential
            self._credential = DefaultAzureCredential()
            
            # Create project client - SDK handles correct auth scope
            self._project_client = AIProjectClient(
                endpoint=endpoint,
                credential=self._credential,
            )
            
            # Get OpenAI client for Responses API
            self._openai_client = self._project_client.get_openai_client()
            
            # Discover agents to verify they exist
            await self._discover_agents()
            
            self._initialized = True
            logger.info(f"FoundryClient initialized | agents={list(self._agents_cache.keys())}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize FoundryClient: {e}")
            return False
    
    async def _discover_agents(self) -> None:
        """Verify agents exist in Foundry."""
        for agent_type, agent_name in AGENT_NAMES.items():
            try:
                loop = asyncio.get_event_loop()
                agent = await loop.run_in_executor(
                    None,
                    lambda name=agent_name: self._project_client.agents.get(agent_name=name)
                )
                self._agents_cache[agent_type] = {
                    "name": agent.name,
                    "id": getattr(agent, 'id', None),
                }
                logger.info(f"Discovered agent: {agent_name}")
            except Exception as e:
                logger.warning(f"Agent not found: {agent_name} - {e}")
    
    async def chat(
        self,
        agent_type: str,
        message: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> AgentResponse:
        """
        Call an agent via the Responses API.
        
        The SDK handles:
        - Correct authentication/token scope
        - Token refresh
        - Retry logic
        
        We just send the message - agent's system prompt handles the rest.
        
        Args:
            agent_type: The type of agent to call
            message: The user message
            context: Optional context data (architecture, conversation history, etc.)
        """
        if not self._initialized:
            await self.initialize()
        if not self._initialized or (self._provider is None and self._openai_client is None):
            kind = resolve_provider_kind()
            if kind == NONE:
                raise AgentsUnavailableError(not_configured_message())
            if self._provider_error:
                raise AgentsUnavailableError(f"AI provider setup failed: {self._provider_error}")
            raise AgentsUnavailableError(
                "Could not connect to Azure AI Foundry. Check AZURE_AI_PROJECT_ENDPOINT "
                "and that you are signed in (az login) with access to the project."
            )

        agent_name = AGENT_NAMES.get(agent_type)
        if not agent_name:
            raise ValueError(f"Unknown agent type: {agent_type}")
        
        try:
            # Build the full message with context if provided
            full_message = message
            if context:
                context_parts = []
                
                # Add architecture context if present
                if "architecture" in context:
                    arch = context["architecture"]
                    context_parts.append(f"Current Architecture:\n{json.dumps(arch, indent=2)}")
                
                # Add conversation history if present
                if "conversation_history" in context:
                    history = context["conversation_history"]
                    if history:
                        history_text = "\n".join([
                            f"{msg.get('role', 'user')}: {msg.get('content', '')}" 
                            for msg in history[-5:]  # Last 5 messages
                        ])
                        context_parts.append(f"Previous Conversation:\n{history_text}")
                
                if context_parts:
                    full_message = "\n\n".join(context_parts) + f"\n\nUser Question: {message}"

            # Ground Azure documentation answers in Microsoft Learn via its MCP server.
            # A Foundry-hosted docs agent already has the MCP tool attached, so this
            # applies to chat-completions providers only (and not to AWS diagrams).
            sources: Optional[List[str]] = None
            grounding: Optional[str] = None
            if agent_type == "azure_docs" and self._provider is not None and not _is_aws_context(context):
                from app.mcp.learn_mcp import format_grounding, get_learn_client

                results = await get_learn_client().search(_grounding_query(message))
                if results:
                    full_message = f"{format_grounding(results)}\n\n{full_message}"
                    sources = [r.url for r in results]
                    grounding = "microsoft-learn-mcp"

            logger.info(f"Calling agent: {agent_name} | message_length={len(full_message)} | has_context={context is not None}")

            if self._provider is not None:
                # Chat-completions provider: the agent is its system prompt.
                output_text = await self._provider.complete(SYSTEM_PROMPTS[agent_type], full_message)
            else:
                # Foundry: call the published agent via the Responses API (sync, run in executor)
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    None,
                    lambda: self._openai_client.responses.create(
                        input=[{"role": "user", "content": full_message}],
                        extra_body={"agent": {"name": agent_name, "type": "agent_reference"}},
                    )
                )
                output_text = getattr(response, 'output_text', str(response))
            
            logger.info(f"Agent response | agent={agent_name} | response_length={len(output_text)}")
            
            return AgentResponse(
                content=output_text,
                agent_name=agent_name,
                agent_type=agent_type,
                sources=sources,
                grounding=grounding,
            )

        except Exception as e:
            logger.error(f"Agent call failed | agent={agent_name} | error={e}")
            raise
    
    def _apply_guardrail_constraints(self, prompt: str, architecture: Dict[str, Any], fmt: str = "bicep") -> str:
        """
        Append security guardrail constraints to an IaC prompt (compliant-by-default).

        Two blocks are appended:
          1. MANDATORY SECURE PROPERTIES - exact property/value pairs the
             deterministic checker verifies, so the enforceable controls pass.
          2. SECURITY GUARDRAILS - broader recommendations (advisory).

        Fail-safe: returns the prompt unchanged if guardrails are disabled, the
        catalog is missing, or anything raises. Never breaks generation.
        """
        try:
            from app.services import guardrails
            if not guardrails.active():
                return prompt
            matched = guardrails.match_guardrails(architecture)
            enforced = guardrails.build_enforced_properties(matched, fmt=fmt)
            identity = guardrails.build_identity_requirements(matched, fmt=fmt)
            constraints = guardrails.build_prompt_constraints(matched)
            # Approved per-service exceptions must come LAST so they override the
            # mandatory public-access lockdown for their named resources only.
            exceptions = guardrails.build_networking_exceptions(architecture, fmt=fmt)
            if enforced or identity or constraints or exceptions:
                logger.info(
                    f"Guardrail constraints injected | "
                    f"resources={matched.get('resource_count', 0)} | "
                    f"env={matched.get('environment_count', 0)}"
                )
                return prompt + enforced + identity + constraints + exceptions
        except Exception as e:  # noqa: BLE001 - fail-safe by design
            logger.debug(f"Guardrail prompt injection skipped: {e}")
        return prompt

    def _apply_networking_constraints(self, prompt: str) -> str:
        """
        Append the centrally-managed networking policy to an IaC prompt.

        Enabled with IAC_REFERENCE_EXISTING_NETWORKS=true for landing-zone /
        hub-spoke estates where a platform team owns VNets, subnets, route tables,
        NSGs and private DNS zones. Generated IaC must then REFERENCE those
        networks, never create them. When disabled (default) the prompt is
        returned unchanged and the diagram decides what networking is created.
        """
        try:
            from app.services.guardrails import reference_existing_networks
            if not reference_existing_networks():
                return prompt
            return prompt + """

NETWORKING POLICY (CENTRALLY MANAGED - MANDATORY):
- All network resources are owned by the platform networking team and ALREADY EXIST.
- NEVER create these resource types in any template or module:
  * Microsoft.Network/virtualNetworks
  * Microsoft.Network/virtualNetworks/subnets
  * Microsoft.Network/routeTables
  * Microsoft.Network/networkSecurityGroups
  * Microsoft.Network/privateDnsZones
- When a service node has "vnetIntegrationEnabled": true (or provides
  subnetResourceId / virtualNetworkName + subnetName), integrate with the
  EXISTING subnet by REFERENCE only:
  * Prefer the provided "subnetResourceId" verbatim as the subnet resource ID.
  * Bicep: reference with the `existing` keyword, e.g.
      resource subnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' existing = {
        name: '<vnet>/<subnet>'
        scope: resourceGroup('<networkResourceGroup>')
      }
    or pass subnetResourceId straight into properties such as
    virtualNetworkSubnetId (App Service/Functions VNet integration) or a private
    endpoint's subnet.id. Accept the subnet resource ID as a parameter.
  * Terraform: use `data "azurerm_subnet"` / `data "azurerm_virtual_network"`
    (never `resource`), or pass the subnet ID in as a variable.
- Private endpoints: reference the existing subnet ID; do not create the subnet.
- If no networking fields are provided for a service, do not invent any VNet or
  subnet; leave the service without VNet integration."""
        except Exception as e:  # noqa: BLE001 - fail-safe by design
            logger.debug(f"Networking prompt injection skipped: {e}")
            return prompt

    async def generate_iac(
        self,
        architecture: Dict[str, Any],
        format: str = "bicep"
    ) -> AgentResponse:
        """
        Call iac-generator-agent.
        
        Agent's system prompt handles all generation logic.
        We just send the architecture and format.
        
        Agent returns structured JSON with:
        - code: The actual IaC template
        - resources: List of resources
        - parameters: Template parameters
        - warnings: Any generation warnings
        - deployment_instructions: How to deploy
        
        We extract the 'code' field for the template content.
        """
        # Enhanced prompt with syntax rules to prevent common errors
        message = (
            f"Generate {format} for the following architecture.\n\n"
            f"ARCHITECTURE:\n{json.dumps(architecture)}\n\n"
            + _SINGLE_FILE_RULES
        )

        # Compliant-by-default: append security guardrails (no-op if disabled/missing).
        message = self._apply_guardrail_constraints(message, architecture, fmt=format)
        # Optional landing-zone policy: reference existing networks, never create them.
        message = self._apply_networking_constraints(message)

        response = await self.chat(agent_type="iac_generator", message=message)
        
        # Agent returns JSON with code field - extract it
        try:
            raw_content = response.content
            
            # Strip markdown code blocks using regex
            # Matches ```json, ```bicep, ``` etc at start and ``` at end
            code_block_match = re.match(r'^```(?:json|bicep|hcl|terraform)?\s*\n?(.*?)\n?```$', raw_content, re.DOTALL)
            if code_block_match:
                raw_content = code_block_match.group(1).strip()
            
            # Try to parse as JSON
            parsed = json.loads(raw_content)
            
            if isinstance(parsed, dict) and "code" in parsed:
                # Extract the actual code and auto-correct common LLM Bicep mistakes
                code = _fix_bicep_syntax(parsed.get("code", ""))

                # Store metadata in sources for access if needed
                metadata = {
                    "resources": parsed.get("resources", []),
                    "parameters": parsed.get("parameters", {}),
                    "warnings": parsed.get("warnings", []),
                    "deployment_instructions": parsed.get("deployment_instructions", ""),
                    "mcp_enhanced": parsed.get("mcp_enhanced", False),
                }

                logger.info(f"Extracted IaC code from JSON | length={len(code)} | resources={len(metadata['resources'])}")

                return AgentResponse(
                    content=code,  # Just the template code
                    agent_name=response.agent_name,
                    agent_type=response.agent_type,
                    sources=[json.dumps(metadata)],  # Store metadata in sources
                )
            else:
                # Not in expected format, return as-is
                logger.warning("Agent response not in expected JSON format, returning raw")
                return response

        except json.JSONDecodeError:
            # Not JSON - might be plain Bicep with or without markdown
            content = response.content

            # Check if it's a bicep code block
            bicep_match = re.match(r'^```(?:bicep)?\s*\n?(.*?)\n?```$', content, re.DOTALL)
            if bicep_match:
                content = bicep_match.group(1).strip()
                logger.info(f"Extracted Bicep from markdown block | length={len(content)}")
            else:
                logger.info(f"Agent returned plain text | length={len(content)}")

            return AgentResponse(
                content=_fix_bicep_syntax(content),
                agent_name=response.agent_name,
                agent_type=response.agent_type,
            )
    
    async def generate_iac_modular(
        self,
        architecture: Dict[str, Any],
        format: str = "bicep"
    ) -> Dict[str, Any]:
        """
        Generate modular IaC templates.
        
        Instructs the agent to generate a production-ready folder structure.
        The agent dynamically categorizes resources into appropriate modules
        based on Azure resource types (not hardcoded).
        
        Returns a dict with:
        - files: List of {path, content, description}
        - structure_summary: Overview of generated structure
        - agent_name: The agent that generated this
        """
        # The prompt instructs the agent to generate modular output
        # The agent's system prompt already knows Azure resource categorization
        modular_prompt = f"""Generate MODULAR {format} templates with production-ready folder structure.

ARCHITECTURE:
{json.dumps(architecture, indent=2)}

OUTPUT FORMAT - Return JSON with this exact structure:
{{
  "files": [
    {{
      "path": "main.bicep",
      "content": "// Deployment command and full bicep content here...",
      "description": "Main orchestrator file"
    }},
    {{
      "path": "parameters/dev.parameters.json",
      "content": "{{\\\"$schema\\\": \\\"https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#\\\", \\\"contentVersion\\\": \\\"1.0.0.0\\\", \\\"parameters\\\": {{...}}}}",
      "description": "Development environment parameters (JSON format for CLI compatibility)"
    }},
    {{
      "path": "modules/compute/appServicePlan.bicep",
      "content": "// App Service Plan module...",
      "description": "App Service Plan module"
    }},
    {{
      "path": "README.md",
      "content": "# Infrastructure Deployment\\n...",
      "description": "Deployment documentation"
    }}
  ],
  "structure_summary": "Generated N files: main.bicep, parameter file, modules, README"
}}

RULES:
1. main.bicep: 
   - Add header comment with deployment command: // az deployment group create -g <rg-name> -f main.bicep -p @parameters/dev.parameters.json
   - Import and orchestrate all modules with proper dependencies
   - Define shared parameters (location, environment, namePrefix)
   - Ensure module dependencies are correctly ordered (e.g., managedIdentity before appService)

2. parameters/dev.parameters.json:
   - Use ARM JSON format (NOT .bicepparam) for CLI compatibility
   - Include $schema and contentVersion
   - Only include parameters that main.bicep expects
   - Extract resource group name from diagram data if available

3. modules/: Organize by category:
   - compute/ for Microsoft.Web/serverfarms, Microsoft.Web/sites, Functions, Container Apps
   - security/ for Microsoft.ManagedIdentity/userAssignedIdentities, Key Vault
   - networking/ for VNets, NSGs, Private Endpoints
   - database/ for Cosmos DB, SQL, PostgreSQL
   - storage/ for Storage Accounts

4. README.md: Professional, enterprise-grade technical documentation.
   - PLAIN TEXT ONLY. Do NOT use emojis, pictographic icons, or decorative
     symbols anywhere (no checkmarks, stars, rockets, sparkles, or similar).
     Section headings are plain Markdown headings (##). This is a hard rule.
   - Title header: "# Infrastructure Deployment" (no branding banners)
   - Prerequisites section (Azure CLI and Bicep CLI versions)
   - Folder structure as an ASCII tree (box-drawing characters are allowed)
   - Step-by-step deployment commands in fenced code blocks
   - Architecture table listing each resource, its type, and purpose
   - A "Security and compliance" section summarising the hardening applied
     (HTTPS-only, minimum TLS, public network access, etc.)
   - IMPORTANT: State "Deploy to EXISTING resource group"

TEMPLATE QUALITY (ENTERPRISE STANDARD - MUST FOLLOW):
- Every parameter has an @description() decorator explaining its purpose
- Provide sensible @allowed() and default values where appropriate
- NO hardcoded secrets, connection strings, keys, or passwords in any file;
  use Key Vault references or secure parameters (@secure()) instead
- Apply a consistent set of resource tags (e.g. environment, managedBy) via a
  shared object parameter, wired through every module
- Expose meaningful outputs (resource IDs, endpoints) from each module and
  surface the important ones from main.bicep
- Use symbolic names and existing-resource references correctly; never
  duplicate a resource that the diagram marks as pre-existing

BICEP SYNTAX RULES (CRITICAL - VIOLATIONS CAUSE DEPLOYMENT FAILURE):

RULE 1 - DECORATOR PLACEMENT:
  Decorators (@description, @allowed, @secure, @minLength) MUST appear on the line
  BEFORE the param declaration. NEVER on the same line or after the param.
  CORRECT:
    @description('Azure region')
    param location string = 'eastus'
  WRONG (causes BCP008/BCP019):
    param location string = 'eastus' @description('Azure region')
    param location string @description('Azure region') = 'eastus'

RULE 2 - OPTIONAL PARAMETERS: use a default value, NEVER the `?` suffix.
  CORRECT: param featureFlag string = ''
  WRONG:   param featureFlag string?   (causes BCP008)

RULE 3 - ROLE ASSIGNMENTS AND RESOURCE NAMES (BCP120 / BCP036):
  Follow this 5-step pattern exactly. Deviation causes deployment-blocking errors.

  STEP 1: Declare ALL resource names as vars in main.bicep, from params only:
    var storageAccountName = '${{namePrefix}}storage'
    var kvName             = '${{namePrefix}}kv'
    var functionAppName    = '${{namePrefix}}func'

  STEP 2: Pass each name var as a param to its module (modules must NOT compute their own names):
    module storageAccount 'modules/storage/storageAccount.bicep' = {{
      params: {{ storageAccountName: storageAccountName, location: location, tags: tags }}
    }}
    module keyVault 'modules/security/keyVault.bicep' = {{
      params: {{ kvName: kvName, tenantId: subscription().tenantId, location: location, tags: tags }}
    }}

  STEP 3: Each module accepts the name as a param and uses it directly:
    // storageAccount.bicep
    param storageAccountName string
    resource storage 'Microsoft.Storage/storageAccounts@2022-09-01' = {{
      name: storageAccountName  // uses the passed-in name
      ...
    }}

  STEP 4: In main.bicep, declare 'existing' refs using the SAME vars from STEP 1:
    resource storageRef 'Microsoft.Storage/storageAccounts@2022-09-01' existing = {{
      name: storageAccountName  // SAME var - definitely deployment-start evaluable
    }}
    resource kvRef 'Microsoft.KeyVault/vaults@2023-02-01' existing = {{
      name: kvName  // SAME var
    }}

  STEP 5: Role assignments use STEP 1 vars for name, STEP 4 refs for scope:
    resource storageBlobRA 'Microsoft.Authorization/roleAssignments@2022-04-01' = {{
      name: guid(namePrefix, storageAccountName, 'StorageBlobDataContributor')
      scope: storageRef
      properties: {{
        roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
        principalId: functionApp.outputs.identityPrincipalId  // module outputs OK in properties
        principalType: 'ServicePrincipal'
      }}
      dependsOn: [storageAccount, functionApp]
    }}

  WRONG patterns (all cause BCP120 or BCP036):
    resource storageRef existing = {{ name: storageAccount.outputs.name }}  // NO - module output
    name: guid(functionAppPrincipalId, ...)   // NO - functionAppPrincipalId is module output
    name: guid(storageAccount.outputs.id, ...) // NO - module output
    scope: storageAccount.outputs.resourceId   // NO - string, not resource ref

RULE 4 - EVERY MODULE PARAMETER MUST BE USED. If a module declares `param storageAccountId`
  but the resource body never references it, DELETE that parameter from the module.
  Every `param` must appear at least once in the module body.

RULE 5 - @allowed MUST be a single inline array: @allowed(['dev', 'tst', 'prd'])
  NEVER split across multiple lines.

RULE 6 - NO unnecessary string interpolation: write  kind: kind  NOT  kind: '${{kind}}'

RULE 7 - API VERSIONS: Use these specific versions (they have local type definitions and are proven):
  Microsoft.Storage/storageAccounts             : 2022-09-01
  Microsoft.KeyVault/vaults                     : 2023-02-01
  Microsoft.Insights/components                 : 2020-02-02
  Microsoft.Web/sites                           : 2022-09-01
  Microsoft.Web/serverfarms                     : 2022-09-01
  Microsoft.Authorization/roleAssignments       : 2022-04-01
  Microsoft.OperationalInsights/workspaces      : 2022-10-01
  Microsoft.ManagedIdentity/userAssignedIdentities : 2023-01-31
  Microsoft.DocumentDB/databaseAccounts         : 2023-04-15
  Microsoft.Sql/servers                         : 2022-11-01-preview
  Microsoft.Network/virtualNetworks             : 2023-04-01
  Microsoft.CognitiveServices/accounts          : 2023-05-01
  Microsoft.Search/searchServices               : 2023-11-01
  All other types: use a 2022 or 2023 version (never 2023-12-01 - it lacks type definitions)

RULE 8 - User-Assigned Managed Identity:
  * identity.type = 'UserAssigned'
  * identity.userAssignedIdentities = {{ '${{identityResourceId}}': {{}} }}
  * DO NOT output resource.identity.principalId (does not exist for UserAssigned)
  * Output principalId from the managedIdentity MODULE output instead

RULE 9 - NO utcNow() IN PARAM DEFAULTS: utcNow() is only valid inside resource property expressions.
  WRONG (causes compilation error): param tags object = {{ CreatedDate: utcNow() }}
  CORRECT: param tags object = {{ Environment: environment, ManagedBy: 'liftoff' }}

RULE 10 - NO SUBNET / VNET PARAMS UNLESS DIAGRAM HAS A VNET NODE:
  Do NOT generate `existingSubnetResourceId`, `subnetResourceId`, or any VNet integration
  parameter unless the architecture diagram explicitly includes a VNet or Subnet node
  connected to the service. If there is no VNet node, set publicNetworkAccess: 'Enabled'
  and omit all subnet/VNet parameters entirely.

RULE 11 - REMOVE UNUSED PARAMETERS: If a param is declared in main.bicep but never referenced
  in the template body or in any module call, DELETE it entirely (e.g. resourceGroupName).

RULE 12 - siteConfig MUST be inside properties, NEVER at resource root (BCP037):
  CORRECT:
    resource site 'Microsoft.Web/sites@2022-09-01' = {{
      properties: {{
        serverFarmId: appServicePlanId
        siteConfig: {{ appSettings: [...] }}   // INSIDE properties
      }}
    }}
  WRONG (causes BCP037):
    resource site 'Microsoft.Web/sites@2022-09-01' = {{
      properties: {{ serverFarmId: appServicePlanId }}
      siteConfig: {{ ... }}  // OUTSIDE properties - BCP037
    }}

RULE 13 - NO string concatenation with + (BCP045). Always use interpolation:
  CORRECT: 'https://${{hostname}}'
  WRONG:   'https://' + hostname

RULE 14 - Key Vault MUST include tenantId in properties (BCP035):
  resource kv 'Microsoft.KeyVault/vaults@2023-02-01' = {{
    properties: {{
      tenantId: tenantId    // REQUIRED - pass tenantId = subscription().tenantId from main.bicep
      sku: {{ name: 'standard', family: 'A' }}
      enableSoftDelete: true
      enableRbacAuthorization: true
    }}
  }}

RULE 15 - Microsoft.CognitiveServices/accounts FORBIDDEN PROPERTIES (BCP037):
  Do NOT set enableHttpsTrafficOnly on CognitiveServices - it is a Storage Account property.
  To harden Azure OpenAI / Cognitive Services use:
    disableLocalAuth: true
    networkAcls: {{ defaultAction: 'Deny' }}
    restrictOutboundNetworkAccess: true
  WRONG (BCP037): properties: {{ enableHttpsTrafficOnly: true }}
  CORRECT:        properties: {{ disableLocalAuth: true, networkAcls: {{ defaultAction: 'Deny' }} }}

RULE 16 - NO UNNECESSARY dependsOn:
  Bicep infers resource dependencies automatically from symbolic name references.
  NEVER add dependsOn for a resource you already reference by symbolic name in properties.
  WRONG (BCP lint no-unnecessary-dependson):
    dependsOn: [appService]  // when properties already use appService.id / appService.outputs.*
  CORRECT: Omit dependsOn entirely - let Bicep infer it.
  Only add dependsOn for true non-reference side-effect dependencies (very rare).

RULE 17 - NO HARDCODED AZURE ENVIRONMENT URLs (no-hardcoded-env-urls):
  Do NOT hardcode 'core.windows.net', 'blob.core.windows.net', or any Azure cloud suffix.
  WRONG: '${{storageAccountName}}.blob.core.windows.net'
  CORRECT: '${{storageAccountName}}.blob.${{environment().suffixes.storage}}'
  Other suffixes: environment().suffixes.keyvaultDns, environment().resourceManager

RULE 18 - STORAGE ACCOUNT NAMES MUST BE GLOBALLY UNIQUE:
  Storage account names are globally unique across ALL Azure customers. Never use generic names.
  CORRECT: var storageAccountName = '${{toLower(namePrefix)}}st${{uniqueString(resourceGroup().id)}}'
  This produces names like 'demostk7x2wr4f6qnbz' - unique per deployment, always available.
  Max 24 chars: '${{toLower(namePrefix)}}' (max 10) + 'st' (2) + uniqueString result (13) = safe.

RULE 19 - Application_Type IS CASE-SENSITIVE for App Insights (BCP089):
  WRONG (BCP089): application_Type: 'web'   // lowercase 'a'
  CORRECT:        Application_Type: 'web'   // capital 'A'
  App Insights REQUIRES both Application_Type and kind at the resource (not properties) level:
    resource appInsights 'Microsoft.Insights/components@2020-02-02' = {{
      kind: 'web'
      properties: {{
        Application_Type: 'web'
        WorkspaceResourceId: logAnalytics.id
      }}
    }}

MODULE PATTERN for App Service with User-Assigned Identity:
  // In managedIdentity.bicep
  output principalId string = identity.properties.principalId
  output resourceId string = identity.id

  // In appService.bicep - receives resourceId, NOT principalId
  param identityResourceId string
  identity: {{
    type: 'UserAssigned'
    userAssignedIdentities: {{ '${{identityResourceId}}': {{}} }}
  }}
  output defaultHostName string = 'https://${{appService.properties.defaultHostName}}'
  output resourceId string = appService.id
  // DO NOT: output principalId string = appService.identity.principalId

DEPLOYMENT SCOPE (ENTERPRISE POLICY):
- Templates target resource group scope (default) - NO targetScope = 'subscription'
- Do NOT create resource groups in templates - assume they exist
- Extract actual resource group name from diagram if present in node data

IMPORTANT: Generate EXACTLY ONE parameter file (dev.parameters.json). Never generate prd or staging files.

Return ONLY the JSON object, no markdown code blocks."""

        # Compliant-by-default: append security guardrails (no-op if disabled/missing).
        modular_prompt = self._apply_guardrail_constraints(modular_prompt, architecture, fmt=format)
        # Optional landing-zone policy: reference existing networks, never create them.
        modular_prompt = self._apply_networking_constraints(modular_prompt)

        response = await self.chat(agent_type="iac_generator", message=modular_prompt)
        
        try:
            # Parse the response
            raw_content = response.content
            
            # Strip markdown code blocks if present
            code_block_match = re.match(r'^```(?:json)?\s*\n?(.*?)\n?```$', raw_content, re.DOTALL)
            if code_block_match:
                raw_content = code_block_match.group(1).strip()
            
            parsed = json.loads(raw_content)

            # Post-process each file: fix Bicep syntax errors, strip emoji from docs.
            # Both are fail-safe - cosmetic only, never break generation.
            try:
                for _f in parsed.get("files", []):
                    path = str(_f.get("path", "")).lower()
                    content = _f.get("content", "")
                    if path.endswith(".bicep"):
                        _f["content"] = _fix_bicep_syntax(content)
                    elif path.endswith(".md"):
                        _f["content"] = _strip_icons(content)
            except Exception:  # noqa: BLE001 - never break generation
                pass

            # Add agent info
            parsed["agent_name"] = response.agent_name

            logger.info(
                f"Generated modular IaC | files={len(parsed.get('files', []))} | "
                f"summary={parsed.get('structure_summary', '')[:50]}"
            )

            # Validate Bicep and auto-fix compiler errors (up to 2 correction attempts).
            # Fail-safe: any exception skips the loop and returns the original files.
            try:
                current_files = parsed.get("files", [])
                for _attempt in range(2):
                    errors = await _validate_bicep_files(current_files)
                    if not errors:
                        break  # templates compile clean - done

                    error_text = "\n".join(errors)
                    bicep_contents = "\n\n".join(
                        f"=== {f['path']} ===\n{f['content']}"
                        for f in current_files
                        if str(f.get("path", "")).endswith(".bicep")
                    )
                    fix_prompt = (
                        f"The following Bicep templates have these compilation errors.\n"
                        f"Fix ONLY the listed errors and return the complete corrected JSON "
                        f"(same structure: files list with path/content/description).\n\n"
                        f"ERRORS TO FIX:\n{error_text}\n\n"
                        f"{_BICEP_FIX_HINT}\n\n"
                        f"CURRENT BICEP FILES:\n{bicep_contents}\n\n"
                        f"Return ONLY valid JSON - no markdown fences."
                    )
                    fix_response = await self.chat(agent_type="iac_generator", message=fix_prompt)
                    try:
                        raw = fix_response.content
                        code_fence = re.match(r'^```(?:json)?\s*\n?(.*?)\n?```$', raw, re.DOTALL)
                        if code_fence:
                            raw = code_fence.group(1).strip()
                        fixed_parsed = json.loads(raw)
                        if isinstance(fixed_parsed, dict) and "files" in fixed_parsed:
                            # Merge corrected .bicep files back; keep non-Bicep files intact.
                            corrected_map = {
                                f["path"]: f
                                for f in fixed_parsed["files"]
                                if str(f.get("path", "")).endswith(".bicep")
                            }
                            current_files = [
                                corrected_map.get(f["path"], f)
                                for f in current_files
                            ]
                            # Re-apply post-processor to corrected files.
                            for _f in current_files:
                                if str(_f.get("path", "")).endswith(".bicep"):
                                    _f["content"] = _fix_bicep_syntax(_f.get("content", ""))
                            logger.info(f"[BicepValidate] Correction attempt {_attempt+1} applied")
                    except (json.JSONDecodeError, Exception) as parse_err:
                        logger.warning(f"[BicepValidate] Could not parse correction response: {parse_err}")
                        break  # fall through with current files

                parsed["files"] = current_files
            except Exception as val_exc:  # noqa: BLE001 - never break generation
                logger.warning(f"[BicepValidate] Validation loop skipped: {val_exc}")

            return parsed
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse modular response: {e}")
            # Return a minimal structure with the raw content
            return {
                "files": [
                    {
                        "path": "main.bicep",
                        "content": response.content,
                        "description": "Generated template (parsing failed)"
                    }
                ],
                "structure_summary": "Failed to parse modular structure, returning single file",
                "agent_name": response.agent_name
            }
    
    async def search_docs(self, query: str) -> AgentResponse:
        """Call azure-docs-agent."""
        return await self.chat(agent_type="azure_docs", message=query)
    
    async def analyze_security(
        self,
        architecture: Dict[str, Any],
        compliance_frameworks: Optional[List[str]] = None
    ) -> AgentResponse:
        """Call security-advisor-agent."""
        frameworks = compliance_frameworks or ["asb"]
        message = f"Analyze security for frameworks {frameworks}:\n{json.dumps(architecture)}"
        return await self.chat(agent_type="security_advisor", message=message)
    
    async def validate_iac(
        self,
        template: str,
        template_type: str = "bicep"
    ) -> AgentResponse:
        """Call validation-agent."""
        message = f"Validate this {template_type}:\n{template}"
        return await self.chat(agent_type="validation", message=message)
    
    def get_agent_info(self, agent_type: str) -> Optional[Dict[str, Any]]:
        """Get info about an agent."""
        return self._agents_cache.get(agent_type)
    
    def list_agents(self) -> Dict[str, Dict[str, Any]]:
        """List all agents."""
        return self._agents_cache.copy()
    
    async def cleanup(self) -> None:
        """Cleanup resources."""
        self._agents_cache.clear()
        self._project_client = None
        self._openai_client = None
        self._initialized = False
        logger.info("FoundryClient cleaned up")


# Singleton accessor
_client_instance: Optional[FoundryClient] = None


def get_foundry_client() -> FoundryClient:
    """Get the singleton FoundryClient instance."""
    global _client_instance
    if _client_instance is None:
        _client_instance = FoundryClient()
    return _client_instance


async def shutdown_foundry_client() -> None:
    """Shutdown the FoundryClient."""
    global _client_instance
    if _client_instance:
        await _client_instance.cleanup()
        _client_instance = None
