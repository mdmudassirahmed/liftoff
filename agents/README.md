# Azure AI Foundry Agents (Standalone)

This folder contains **standalone scripts** to create, test, and manage agents in **NEW Microsoft Foundry** with **MCP (Model Context Protocol)** tool support.

> This folder is **independent** of the backend code. You can copy it anywhere and run it standalone.

## Folder Structure

```
agents/
├── .env                  # Your configuration (copy from .env.example)
├── .env.example          # Configuration template
├── requirements.txt      # Python dependencies
├── config.py             # Configuration loader
├── create_agents.py      # Create all agents (with MCP!)
├── test_agent.py         # Test agent conversations
├── test_mcp.py           # Test MCP tool integration
├── delete_agents.py      # Delete agents
├── agents_info.json      # Generated agent metadata
└── README.md             # This file
```

## Quick Start

### 1. Setup Environment

```bash
cd agents
pip install -r requirements.txt
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your Azure AI Foundry project details
```

### 3. Authenticate with Azure

```bash
az login
az account set --subscription "your-subscription-name"
```

### 4. Create Agents

```bash
python create_agents.py
```

### 5. Test Agents

```bash
# Interactive chat
python test_agent.py

# Test specific agent
python test_agent.py --agent azure-docs-agent

# Test MCP integration
python test_mcp.py
```

---

## Agents Created

| Agent | MCP Server | Capabilities |
|-------|------------|--------------|
| **azure-docs-agent** | Microsoft Learn | Search & fetch official Azure documentation |
| **iac-generator-agent** | None | Generate Bicep, Terraform, ARM templates |
| **security-advisor-agent** | None | Security analysis, compliance checking |
| **orchestrator-agent** | None | Multi-agent coordination (A2A) |

---

## MCP Integration

The `azure-docs-agent` is created with the **Microsoft Learn MCP Server** attached:

```python
from azure.ai.projects.models import MCPTool, PromptAgentDefinition

mcp_tool = MCPTool(
    server_label="microsoft-learn",
    server_url="https://learn.microsoft.com/api/mcp",
    require_approval="never",  # Safe for read-only operations
)

agent = project_client.agents.create_version(
    agent_name="azure-docs-agent",
    definition=PromptAgentDefinition(
        model="gpt-4.1",
        instructions="...",
        tools=[mcp_tool],  # MCP attached here!
    ),
)
```

### MCP Tools Available

The Microsoft Learn MCP server provides:
- `microsoft_docs_search` - Search documentation by query
- `microsoft_docs_fetch` - Fetch specific documentation content

### Adding More MCP Servers

To add other MCP servers (e.g., GitHub):

```python
github_mcp = MCPTool(
    server_label="github",
    server_url="https://api.githubcopilot.com/mcp",
    require_approval="always",  # Requires approval for sensitive operations
    project_connection_id="your-github-connection-name",  # For authentication
)
```

---

## Authentication

This package uses **DefaultAzureCredential**, which tries multiple auth methods:

1. **Azure CLI** (`az login`) - Recommended for local development
2. **Environment variables** - For CI/CD
3. **Managed Identity** - For Azure-hosted environments
4. **VS Code** - If signed in via Azure extension

### Required Permissions

- `Contributor` or `Owner` role on the Azure AI Foundry project
- Access to create and manage agents

---

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `AZURE_AI_PROJECT_ENDPOINT` | Your Foundry project endpoint |
| `AZURE_AI_MODEL_DEPLOYMENT_NAME` | Model deployment name (e.g., `gpt-4.1`) |
| `OPENAI_API_VERSION` | API version for conversations API |

### Optional Environment Variables

| Variable | Description |
|----------|-------------|
| `MCP_PROJECT_CONNECTION_NAME` | Connection name for authenticated MCP servers |
| `MCP_MICROSOFT_LEARN_URL` | Override Microsoft Learn MCP URL |
| `MCP_GITHUB_URL` | GitHub MCP server URL |

---

## Testing

### Test Basic Agent Chat

```bash
python test_agent.py --agent azure-docs-agent --message "What is Azure App Service?"
```

### Test MCP Tools

```bash
python test_mcp.py
```

Expected output:
```
Query: What is Azure App Service and what are its pricing tiers?
Sending request (agent may invoke MCP tools)...

Agent Response:
Azure App Service is a fully managed platform...
[Documentation from Microsoft Learn]
```

### Interactive Chat

```bash
python test_agent.py

Starting chat with: azure-docs-agent:1
   Type 'quit' to exit

You: How do I configure managed identity?
Agent: ...
```

---

## Cleanup

### Delete Created Agents

```bash
python delete_agents.py
```

### Delete ALL Agents in Project

```bash
python delete_agents.py --all
```

### Delete Specific Agent

```bash
python delete_agents.py --name azure-docs-agent
```

---

## Agent Metadata

After running `create_agents.py`, agent info is saved to `agents_info.json`:

```json
{
  "created_at": "2026-02-10T...",
  "project_endpoint": "https://...",
  "model": "gpt-4.1",
  "foundry_version": "new",
  "agents": {
    "azure_docs": {
      "agent_id": "azure-docs-agent:1",
      "agent_name": "azure-docs-agent",
      "agent_version": 1,
      "has_mcp": true,
      "mcp_servers": [{
        "label": "microsoft-learn",
        "url": "https://learn.microsoft.com/api/mcp"
      }]
    }
  }
}
```

---

## References

- [Connect agents to MCP servers](https://learn.microsoft.com/azure/ai-services/agents/how-to/tools/mcp)
- [Azure AI Projects SDK](https://pypi.org/project/azure-ai-projects/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Microsoft Learn MCP](https://learn.microsoft.com/api/mcp)
