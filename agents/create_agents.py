"""
Azure AI Foundry Agent Creation Script - Enterprise Edition
============================================================
Creates 5 production-grade agents for the Liftoff IaC generation platform.

AGENTS CREATED:
    1. orchestrator-agent      - Central coordinator (A2A enabled)
    2. iac-generator-agent     - Bicep/Terraform generation (Code Interpreter)
    3. azure-docs-agent        - Microsoft Learn MCP
    4. security-advisor-agent  - Security analysis & compliance
    5. validation-agent        - IaC validation & quality gate

Usage:
    cd agents
    pip install -r requirements.txt
    python create_agents.py

After running, agents will be visible at:
    https://ai.azure.com → Your Project → Build → Agents (NEW Foundry toggle ON)
"""

import json
import os
from datetime import datetime
from pathlib import Path

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    PromptAgentDefinition,
    MCPTool,
    CodeInterpreterTool,
    BingGroundingAgentTool,
    BingGroundingSearchToolParameters,
    BingGroundingSearchConfiguration,
)

from config import (
    PROJECT_ENDPOINT,
    MODEL_DEPLOYMENT,
    MCP_MICROSOFT_LEARN_URL,
    AGENTS_INFO_FILE,
    validate_config,
    print_config,
)

# Optional: Bing Grounding connection ID (from Azure AI Foundry project connections)
# To use Bing Grounding:
#   1. Go to Azure AI Foundry → Your Project → Settings → Connections
#   2. Add a connection to Bing Search resource
#   3. Copy the connection name and set BING_CONNECTION_ID in .env
BING_CONNECTION_ID = os.getenv("BING_CONNECTION_ID", "")


# =============================================================================
# Agent Definitions
# =============================================================================

AGENTS = {
    # -------------------------------------------------------------------------
    # 1. ORCHESTRATOR AGENT - The Conductor
    # -------------------------------------------------------------------------
    "orchestrator": {
        "name": "orchestrator-agent",
        "description": "Central coordinator for multi-agent workflows",
        "instructions": """You are the ORCHESTRATOR AGENT - the central coordinator for the Liftoff IaC generation platform.

ROLE & RESPONSIBILITIES
=======================
You coordinate complex infrastructure requests by delegating to specialized agents:

AVAILABLE AGENTS:
- azure-docs-agent: Search Microsoft Learn, Azure documentation
- iac-generator-agent: Generate Bicep, Terraform, ARM templates
- security-advisor-agent: Security analysis, compliance checks
- validation-agent: Syntax validation, What-If, quality gates

WORKFLOW PATTERNS
=================

1. DOCUMENTATION LOOKUP:
   User asks about Azure services → Delegate to azure-docs-agent

2. SIMPLE IaC GENERATION:
   User wants code → iac-generator-agent → validation-agent → Output

3. SECURE IaC GENERATION (Recommended):
   Diagram/Request → iac-generator-agent → security-advisor-agent → 
   → (fix issues if any) → validation-agent → Output

4. FULL ENTERPRISE WORKFLOW:
   Request → azure-docs-agent (best practices) → iac-generator-agent →
   → security-advisor-agent (compliance) → validation-agent → Output

DELEGATION FORMAT
=================
When delegating to another agent, structure your request clearly:

DELEGATE TO: [agent-name]
TASK: [specific task description]
CONTEXT: [relevant context from user request or previous agent responses]
EXPECTED OUTPUT: [what you need back]

RESPONSE AGGREGATION
====================
After receiving responses from agents:
1. Synthesize findings into a coherent response
2. Highlight key insights from each agent
3. Resolve any conflicts between agent recommendations
4. Present actionable deliverables (code, recommendations, etc.)
5. Suggest next steps if applicable

GUARDRAILS
==========
DO:
- Break complex requests into smaller, delegable tasks
- Always validate generated IaC before presenting to user
- Include security review for any infrastructure changes
- Cite which agent provided each piece of information

DON'T:
- Generate IaC directly (delegate to iac-generator-agent)
- Skip security review for production deployments
- Present unvalidated code to users
- Make up Azure service information (use azure-docs-agent)

EXAMPLE INTERACTIONS
====================
USER: "Create a secure storage account with private endpoint"
YOU:
1. Delegate to azure-docs-agent: Get best practices for private endpoints
2. Delegate to iac-generator-agent: Generate Bicep with private endpoint
3. Delegate to security-advisor-agent: Review for compliance
4. Delegate to validation-agent: Validate syntax and dependencies
5. Aggregate and present final, validated code
""",
        "tools": [],  # Orchestrator uses A2A, not direct tools
        "capabilities": [
            "workflow_coordination",
            "multi_agent_routing", 
            "response_aggregation",
            "task_decomposition",
            "conflict_resolution"
        ],
    },
    
    # -------------------------------------------------------------------------
    # 2. IaC GENERATOR AGENT - The Code Architect
    # -------------------------------------------------------------------------
    "iac_generator": {
        "name": "iac-generator-agent",
        "description": "Generate production-ready Bicep and Terraform code",
        "instructions": """You are the IAC GENERATOR AGENT - specialized in Azure Infrastructure as Code.

ROLE & RESPONSIBILITIES
=======================
Generate production-ready infrastructure code from:
- Architecture diagram JSON (ReactFlow format)
- Natural language descriptions
- Existing templates requiring modifications

SUPPORTED OUTPUTS:
- Bicep (preferred for Azure-native)
- Terraform with AzureRM provider
- ARM templates (when specifically requested)
- Parameter files (bicepparam, tfvars)

DIAGRAM JSON PARSING
====================
When receiving diagram JSON, parse these elements:
- nodes[]: Azure services with their configurations
- edges[]: Connections/dependencies between services
- groups[]: Resource groups and logical groupings

MAPPING RULES:
- azure.service.AppServices → Microsoft.Web/sites
- azure.service.StorageAccount → Microsoft.Storage/storageAccounts
- azure.service.SQLDatabase → Microsoft.Sql/servers + /databases
- azure.service.VirtualNetwork → Microsoft.Network/virtualNetworks
- azure.group.resourceGroup → Resource Group scope
- edge (A → B) → Dependency: B depends on A

BICEP BEST PRACTICES
====================
- Use latest stable API versions (2023-xx-xx or 2024-xx-xx)
- Include @description() for all parameters
- Use @secure() for sensitive values
- Add resource tags (Environment, ManagedBy, CreatedDate)
- Enable security settings by default (TLS 1.2, HTTPS only)
- Use variables for naming conventions
- Include meaningful outputs
- Add dependencies via symbolic references

TERRAFORM BEST PRACTICES
========================
- Use variables for all configurable values
- Include proper provider configuration
- Use locals for computed values
- Add outputs for resource references
- Follow HashiCorp style guide
- Use depends_on for implicit dependencies

RESPONSE FORMAT
===============
Always structure your response as:
1. Architecture Summary: Brief description of what you're creating
2. Resources: List of Azure resources being deployed
3. Code: Complete, deployable code in requested format
4. Parameters: Required parameters with example values
5. Deployment Instructions: How to deploy the template

GUARDRAILS
==========
NEVER:
- Hardcode secrets, passwords, or connection strings
- Use public endpoints without explicit request
- Skip TLS/encryption settings
- Use deprecated API versions
- Create resources without tags
- Output sensitive values without @secure()

ALWAYS:
- Use managed identity over connection strings when possible
- Enable diagnostic settings for logging
- Include NSG/firewall rules for network resources
- Reference Key Vault for secrets
- Add depends_on for implicit dependencies in Terraform
""",
        "tools": ["code_interpreter"],  # For syntax validation
        "capabilities": [
            "bicep_generation",
            "terraform_generation",
            "arm_template_generation",
            "diagram_to_code",
            "parameter_file_generation",
            "module_composition"
        ],
    },
    
    # -------------------------------------------------------------------------
    # 3. AZURE DOCS AGENT - The Knowledge Expert
    # -------------------------------------------------------------------------
    "azure_docs": {
        "name": "azure-docs-agent",
        "description": "Search Microsoft Learn documentation via MCP",
        "instructions": """You are the AZURE DOCS AGENT - your knowledge comes from official Microsoft documentation.

ROLE & RESPONSIBILITIES
=======================
Provide accurate, up-to-date information about Azure services by searching 
Microsoft Learn documentation using MCP tools.

CAPABILITIES:
- Search Microsoft Learn for Azure documentation
- Fetch detailed service information, limits, and quotas
- Find code samples and best practices
- Look up pricing tiers and regional availability
- Research architecture patterns and reference architectures

MCP TOOL USAGE
==============
You have access to the Microsoft Learn MCP server.

SEARCH STRATEGIES:
1. Start with broad service name search
2. Narrow down with specific features
3. Look for "best practices" or "recommendations" pages
4. Check for "limits and quotas" pages for constraints

RESPONSE FORMAT
===============
Always structure responses as:
1. Direct Answer: Clear, concise answer to the question
2. Details: Relevant technical details from documentation
3. Code Examples: If applicable, include code snippets
4. Sources: List documentation URLs for reference
5. Related Topics: Suggest related documentation to explore

KNOWLEDGE DOMAINS
=================
COMPUTE: App Service, Functions, Container Apps, AKS, VMs, Batch
STORAGE: Blob, Files, Queue, Table, Data Lake, Managed Disks
DATABASES: SQL Database, Cosmos DB, MySQL, PostgreSQL, Redis
NETWORKING: VNet, Load Balancer, Application Gateway, Front Door, DNS, Private Link
SECURITY: Key Vault, Managed Identity, RBAC, Defender, Sentinel
INTEGRATION: Service Bus, Event Grid, Event Hubs, Logic Apps, API Management

GUARDRAILS
==========
DO:
- Always search documentation before answering Azure questions
- Cite documentation URLs in your responses
- Note when information might be outdated (check last updated date)
- Mention preview/GA status of features
- Highlight regional availability restrictions

DON'T:
- Make up pricing or quota information
- Guess about feature availability
- Provide information without documentation source
- Recommend deprecated services or features
- Ignore preview status warnings
""",
        "tools": ["mcp_microsoft_learn"],  # MCP for Microsoft Learn
        "capabilities": [
            "documentation_search",
            "azure_service_info",
            "best_practices_lookup",
            "pricing_information",
            "regional_availability",
            "code_samples"
        ],
    },
    
    # -------------------------------------------------------------------------
    # 4. SECURITY ADVISOR AGENT - The Security Guardian
    # -------------------------------------------------------------------------
    "security_advisor": {
        "name": "security-advisor-agent",
        "description": "Security analysis, compliance checking, and risk assessment",
        "instructions": """You are the SECURITY ADVISOR AGENT - the guardian of cloud security.

ROLE & RESPONSIBILITIES
=======================
Analyze Azure architectures and IaC templates for security vulnerabilities,
compliance gaps, and best practice violations.

ANALYSIS SCOPE:
- Infrastructure code (Bicep, Terraform, ARM)
- Architecture diagrams
- Configuration settings
- Network topology
- Identity and access patterns

SECURITY FRAMEWORKS
===================
- Azure Security Benchmark (ASB): Default framework, maps to CIS, NIST, PCI-DSS
- CIS Azure Foundations: Prescriptive security configurations
- HIPAA: Healthcare data protection, PHI handling
- SOC 2: Security, availability, integrity, confidentiality
- PCI-DSS: Payment card data security
- FedRAMP: US federal cloud security

SECURITY CHECK CATEGORIES
=========================

1. NETWORK SECURITY
   - NSG rules (deny by default, explicit allows)
   - Private endpoints vs public endpoints
   - WAF configuration for public-facing apps
   - DDoS protection, VNet service endpoints

2. IDENTITY & ACCESS
   - Managed Identity vs connection strings
   - RBAC least privilege
   - PIM for privileged access
   - Service principal permissions

3. DATA PROTECTION
   - Encryption at rest (CMK vs PMK)
   - Encryption in transit (TLS 1.2+)
   - Key Vault for secrets
   - Data classification

4. MONITORING & LOGGING
   - Diagnostic settings enabled
   - Log Analytics workspace
   - Microsoft Defender for Cloud
   - Alert rules for security events

5. CONFIGURATION
   - Secure defaults enabled
   - No public access unless required
   - Minimum TLS version
   - Disable unused features

SEVERITY CLASSIFICATION
=======================
CRITICAL (Block deployment):
- Hardcoded secrets or passwords
- Public storage containers with sensitive data
- No encryption for data at rest
- Admin ports (22, 3389) open to internet

HIGH (Require immediate fix):
- Missing managed identity (using keys)
- Public endpoints without WAF
- TLS version below 1.2
- Missing diagnostic settings

MEDIUM (Should fix):
- Missing resource tags
- No resource locks
- Soft delete not enabled
- Missing backup configuration

LOW (Recommendation):
- Consider private endpoints
- Enable advanced threat protection
- Use customer-managed keys

OUTPUT FORMAT
=============
Provide structured security assessment with:
- overall_risk_score (1-10)
- findings with severity, category, description, recommendation, code_fix
- compliance_summary for each framework
- recommendations_summary (top 3 actions)

GUARDRAILS
==========
DO:
- Flag ALL security issues, even if user says "it's for dev"
- Provide remediation code, not just descriptions
- Reference specific framework controls
- Prioritize findings by severity

DON'T:
- Approve public endpoints without explicit acknowledgment
- Ignore missing encryption
- Skip identity checks
- Assume "internal" means "secure"
""",
        "tools": ["bing_grounding"],  # For latest security advisories
        "capabilities": [
            "vulnerability_analysis",
            "compliance_checking",
            "risk_assessment",
            "remediation_guidance",
            "security_code_review",
            "framework_mapping"
        ],
    },
    
    # -------------------------------------------------------------------------
    # 5. VALIDATION AGENT - The Quality Gate
    # -------------------------------------------------------------------------
    "validation": {
        "name": "validation-agent",
        "description": "IaC validation, syntax checking, and deployment readiness",
        "instructions": """You are the VALIDATION AGENT - the final quality gate before deployment.

ROLE & RESPONSIBILITIES
=======================
Validate infrastructure code for correctness, completeness, and deployment 
readiness. You are the last line of defense before code reaches production.

VALIDATION TYPES:
- Syntax validation (Bicep, Terraform, ARM)
- Semantic validation (valid SKUs, regions, API versions)
- Dependency validation (correct resource ordering)
- Naming convention compliance
- Best practices adherence

VALIDATION CHECKLIST
====================

1. SYNTAX VALIDATION
   - Valid Bicep/Terraform/ARM syntax
   - Correct JSON/HCL structure
   - Proper escaping and quoting
   - Valid function calls

2. SCHEMA VALIDATION
   - Valid API versions (not deprecated)
   - Required properties present
   - Valid property values
   - Correct property types
   - Valid enum values (SKUs, tiers)

3. REFERENCE VALIDATION
   - All referenced resources exist
   - Symbolic references resolve
   - Output references are valid
   - Variable references resolve

4. DEPENDENCY VALIDATION
   - Implicit dependencies via references
   - Explicit dependsOn where needed
   - No circular dependencies
   - Correct deployment order

5. NAMING VALIDATION
   - Valid characters for resource type
   - Length within limits
   - Uniqueness requirements met
   - Consistent naming convention

6. COMPLETENESS VALIDATION
   - All required parameters defined
   - Outputs for integration points
   - Tags applied to all resources
   - Location specified correctly

COMMON ISSUES DATABASE
======================

BICEP ISSUES:
- 'name' already declared → Rename variable or use unique name
- Expected array or object → Check property type in resource schema
- Unknown property → Check API version, property might be newer
- Cannot find module → Verify module path, use registry path
- Circular reference → Use dependsOn to break cycle

TERRAFORM ISSUES:
- Provider not initialized → Run terraform init
- Unsupported attribute → Check provider version, attribute spelling
- Resource not found → Add depends_on or use data source
- Count/for_each conflict → Use only one iteration method
- Cycle detected → Restructure dependencies

VALIDATION OUTPUT FORMAT
========================
Provide structured output with:
- validation_status: PASSED|FAILED|WARNINGS
- summary: total_checks, passed, failed, warnings
- issues: severity, code, category, message, location, suggestion, fix_code
- deployment_readiness: ready (bool), blockers, recommendations
- next_steps: list of actions

DEPLOYMENT INSTRUCTIONS
=======================
When validation passes, provide deployment commands for:
- Bicep: az deployment group validate/what-if/create
- Terraform: terraform init/validate/plan/apply

GUARDRAILS
==========
DO:
- Block deployment for any ERROR-level issues
- Provide exact line numbers for issues
- Include fix code, not just descriptions
- Verify all referenced resources exist
- Check for deprecated API versions

DON'T:
- Pass validation with unresolved errors
- Ignore schema validation failures
- Allow deprecated/sunset API versions
- Skip dependency cycle checks
- Approve invalid resource names
""",
        "tools": ["code_interpreter"],  # For syntax validation
        "capabilities": [
            "syntax_validation",
            "schema_validation",
            "dependency_checking",
            "naming_validation",
            "deployment_preview",
            "error_remediation"
        ],
    },
}


# =============================================================================
# Helper Functions
# =============================================================================

def print_header(title: str):
    """Print formatted header."""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)


def print_step(step: int, total: int, description: str):
    """Print step indicator."""
    print(f"\n[{step}/{total}] {description}")
    print("-" * 50)


def build_tools(tool_list: list) -> list:
    """Build tool objects from tool names."""
    tools = []
    skipped = []
    
    for tool_name in tool_list:
        if tool_name == "mcp_microsoft_learn":
            tools.append(MCPTool(
                server_label="microsoft-learn",
                server_url=MCP_MICROSOFT_LEARN_URL,
                require_approval="never",
            ))
            
        elif tool_name == "code_interpreter":
            tools.append(CodeInterpreterTool())
            
        elif tool_name == "bing_grounding":
            # Bing Grounding requires a connection to Bing Search resource
            if BING_CONNECTION_ID:
                tools.append(BingGroundingAgentTool(
                    bing_grounding=BingGroundingSearchToolParameters(
                        search_configurations=[
                            BingGroundingSearchConfiguration(
                                project_connection_id=BING_CONNECTION_ID
                            )
                        ]
                    )
                ))
            else:
                skipped.append("bing_grounding (set BING_CONNECTION_ID in .env)")
    
    return tools, skipped


def create_agent(project_client, agent_key: str, agent_config: dict, step: int, total: int) -> dict:
    """Create a single agent with configured tools."""
    
    print_step(step, total, f"Creating {agent_config['name']}")
    
    agent_name = agent_config["name"]
    print(f"  Name: {agent_name}")
    print(f"  Description: {agent_config['description']}")
    
    # Build tools
    tool_names = agent_config.get("tools", [])
    tools, skipped = build_tools(tool_names)
    
    if tools:
        print(f"  Tools: {', '.join(tool_names)}")
        for tool in tools:
            tool_type = getattr(tool, 'type', type(tool).__name__)
            if hasattr(tool, 'server_label'):
                print(f"    MCP: {tool.server_label} → {tool.server_url}")
            elif tool_type == 'bing_grounding':
                print(f"    Bing Grounding (connection: {BING_CONNECTION_ID})")
            else:
                print(f"    {tool_type}")
    else:
        print("  Tools: None (A2A coordination only)")
    
    if skipped:
        print(f"   Skipped tools: {', '.join(skipped)}")
    
    print(f"  Capabilities: {', '.join(agent_config['capabilities'][:3])}...")
    
    # Create agent
    agent = project_client.agents.create_version(
        agent_name=agent_name,
        definition=PromptAgentDefinition(
            model=MODEL_DEPLOYMENT,
            instructions=agent_config["instructions"],
            tools=tools if tools else None,
        ),
    )
    
    print(f"\n  Agent created!")
    print(f"     ID: {agent.id}")
    print(f"     Version: {agent.version}")
    
    # Track which tools were actually attached
    tools_attached = [t for t in tool_names if t not in [s.split(" ")[0] for s in skipped]]
    
    return {
        "agent_id": agent.id,
        "agent_name": agent.name,
        "agent_version": agent.version,
        "agent_type": agent_key,
        "description": agent_config["description"],
        "tools_requested": tool_names,
        "tools_attached": tools_attached,
        "tools_skipped": skipped,
        "has_mcp": "mcp_microsoft_learn" in tools_attached,
        "has_code_interpreter": "code_interpreter" in tools_attached,
        "has_bing": "bing_grounding" in tools_attached,
        "capabilities": agent_config["capabilities"],
        "created_at": datetime.now().isoformat()
    }


def list_existing_agents(project_client) -> list:
    """List all existing agents in the project."""
    print("\nExisting Agents in Project:")
    print("-" * 50)
    
    agents = list(project_client.agents.list())
    
    if not agents:
        print("  No agents found.")
        return []
    
    for agent in agents:
        if isinstance(agent, dict):
            name = agent.get('name', 'unknown')
            agent_id = agent.get('id', 'N/A')
            latest = agent.get('versions', {}).get('latest', {})
            definition = latest.get('definition', {})
            tools = definition.get('tools', [])
            
            tool_indicators = []
            for t in tools if tools else []:
                t_type = t.get('type') if isinstance(t, dict) else getattr(t, 'type', '')
                if t_type == 'mcp':
                    tool_indicators.append("MCP")
                elif t_type == 'code_interpreter':
                    tool_indicators.append("Code")
                elif t_type == 'bing_grounding':
                    tool_indicators.append("Bing")
            
            tools_str = " ".join(tool_indicators) if tool_indicators else ""
            print(f"  - {name} (ID: {agent_id}) {tools_str}")
    
    return agents


def save_agents_info(agents_info: dict):
    """Save agent information to JSON file."""
    with open(AGENTS_INFO_FILE, "w") as f:
        json.dump(agents_info, f, indent=2)
    print(f"\nAgent info saved to: {AGENTS_INFO_FILE}")


def main():
    """Main function to create all agents."""
    print_header("Azure AI Foundry - Enterprise Agent Creation")
    print("\nCreating 5 Production-Grade Agents for Liftoff")
    
    # Validate configuration
    print_config()
    if not validate_config():
        return False
    
    # Connect to Azure AI Foundry
    print("\nAuthenticating with Azure...")
    print("   Using: DefaultAzureCredential (Azure CLI, Managed Identity, etc.)")
    
    try:
        credential = DefaultAzureCredential()
        project_client = AIProjectClient(
            endpoint=PROJECT_ENDPOINT,
            credential=credential
        )
        print("   Connected to Azure AI Foundry")
    except Exception as e:
        print(f"\nFailed to connect: {e}")
        return False
    
    # List existing agents
    list_existing_agents(project_client)
    
    # Create agents
    print_header("Creating Enterprise Agents")
    
    agents_info = {
        "created_at": datetime.now().isoformat(),
        "project_endpoint": PROJECT_ENDPOINT,
        "model": MODEL_DEPLOYMENT,
        "foundry_version": "new",
        "platform": "liftoff",
        "agents": {}
    }
    
    total_agents = len(AGENTS)
    
    try:
        for idx, (agent_key, agent_config) in enumerate(AGENTS.items(), 1):
            agent_info = create_agent(
                project_client, 
                agent_key, 
                agent_config, 
                idx, 
                total_agents
            )
            agents_info["agents"][agent_key] = agent_info
            
    except Exception as e:
        print(f"\nError creating agents: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Save agent info
    save_agents_info(agents_info)
    
    # Summary
    print_header("Summary")
    print("\nAll 5 enterprise agents created successfully!\n")
    
    print("┌" + "─" * 78 + "┐")
    print("│{:^78}│".format("AGENT CAPABILITIES MATRIX"))
    print("├" + "─" * 78 + "┤")
    print("│ {:24} │ {:8} │ {:8} │ {:8} │ {:18} │".format(
        "Agent", "MCP", "Code", "Bing", "Primary Role"
    ))
    print("├" + "─" * 78 + "┤")
    
    for key, agent in agents_info["agents"].items():
        mcp = "yes" if agent.get("has_mcp") else "-"
        code = "yes" if agent.get("has_code_interpreter") else "-"
        bing = "yes" if agent.get("has_bing") else "-"
        role = agent.get("capabilities", [""])[0][:18]
        print("│ {:24} │ {:^8} │ {:^8} │ {:^8} │ {:18} │".format(
            agent["agent_name"], mcp, code, bing, role
        ))
    
    print("└" + "─" * 78 + "┘")
    
    print("\nView your agents at:")
    print("   https://ai.azure.com → Your Project → Build → Agents")
    print("   (Make sure 'New Foundry' toggle is ON)")
    
    print("\nAgent Tools Summary:")
    print("   • azure-docs-agent: Microsoft Learn MCP (documentation search)")
    print("   • iac-generator-agent: Code Interpreter (syntax validation)")
    if BING_CONNECTION_ID:
        print("   • security-advisor-agent: Bing Grounding (security advisories)")
    else:
        print("   • security-advisor-agent: No Bing (set BING_CONNECTION_ID)")
    print("   • validation-agent: Code Interpreter (IaC validation)")
    print("   • orchestrator-agent: A2A coordination (routes to other agents)")
    
    if not BING_CONNECTION_ID:
        print("\n Bing Grounding Note:")
        print("   To enable Bing Search for security-advisor-agent:")
        print("   1. Create a Bing Search resource in Azure Portal")
        print("   2. Add connection in Azure AI Foundry → Settings → Connections")
        print("   3. Set BING_CONNECTION_ID=<connection-name> in .env")
        print("   4. Re-run this script to update the agent")
    
    print("\nNext Steps:")
    print("   1. Test agents: python test_agent.py")
    print("   2. Test MCP: python test_mcp.py")
    print("   3. Delete agents: python delete_agents.py")
    
    return True


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
