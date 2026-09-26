"""
Manage the Liftoff agents on Azure AI Foundry.

Only needed for AI_PROVIDER=foundry. With OpenAI, Azure OpenAI or a local
OpenAI-compatible model the backend sends the prompts directly and nothing has
to be created.

The agents are defined in app/agents/prompts.py (the same prompts every other
provider uses). Authentication is keyless through DefaultAzureCredential, so run
`az login` first. Settings come from backend/.env:

    AZURE_AI_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
    AI_MODEL=gpt-4.1          # model deployment the agents run on

Usage (from backend/):

    python scripts/foundry_agents.py create              # create or update all six agents
    python scripts/foundry_agents.py create --dry-run    # show what would be created
    python scripts/foundry_agents.py list
    python scripts/foundry_agents.py chat azure_docs "Which App Service tier supports VNet integration?"
    python scripts/foundry_agents.py delete              # delete the Liftoff agents only
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.prompts import AGENTS, SYSTEM_PROMPTS  # noqa: E402
from app.core.config import get_settings  # noqa: E402


def _project_client():
    from azure.ai.projects import AIProjectClient
    from azure.identity import DefaultAzureCredential

    endpoint = get_settings().AZURE_AI_PROJECT_ENDPOINT
    if not endpoint:
        sys.exit("Set AZURE_AI_PROJECT_ENDPOINT in backend/.env first.")
    return AIProjectClient(endpoint=endpoint, credential=DefaultAzureCredential())


def build_tools(tool_names: list[str]) -> list:
    """Foundry tool objects for an agent's `foundry_tools` list."""
    from azure.ai.projects.models import CodeInterpreterTool, MCPTool

    tools = []
    for name in tool_names:
        if name == "mcp_microsoft_learn":
            tools.append(MCPTool(
                server_label="microsoft-learn",
                server_url=get_settings().MCP_MICROSOFT_DOCS_URL,
                require_approval="never",  # read-only documentation search
            ))
        elif name == "code_interpreter":
            tools.append(CodeInterpreterTool())
        else:
            raise ValueError(f"Unknown Foundry tool: {name}")
    return tools


def create(dry_run: bool = False) -> None:
    model = get_settings().AI_MODEL
    if dry_run:
        for agent_type, spec in AGENTS.items():
            tools = ", ".join(spec["foundry_tools"]) or "none"
            print(f"{spec['name']:26} model={model}  tools={tools}  prompt={len(SYSTEM_PROMPTS[agent_type])} chars")
        return

    from azure.ai.projects.models import PromptAgentDefinition

    client = _project_client()
    for agent_type, spec in AGENTS.items():
        tools = build_tools(spec["foundry_tools"])
        agent = client.agents.create_version(
            agent_name=spec["name"],
            description=spec["description"],
            definition=PromptAgentDefinition(
                model=model,
                instructions=SYSTEM_PROMPTS[agent_type],
                tools=tools or None,
            ),
        )
        print(f"{spec['name']:26} version {agent.version}")
    print(f"\n{len(AGENTS)} agents ready. Set AI_PROVIDER=foundry (or leave auto) and start the backend.")


def list_agents() -> None:
    ours = {spec["name"] for spec in AGENTS.values()}
    for agent in _project_client().agents.list():
        name = agent.get("name") if isinstance(agent, dict) else agent.name
        print(f"{name}{'' if name in ours else '   (not a Liftoff agent)'}")


def chat(agent_type: str, message: str) -> None:
    if agent_type not in AGENTS:
        sys.exit(f"Unknown agent '{agent_type}'. Choose from: {', '.join(AGENTS)}")
    openai_client = _project_client().get_openai_client()
    response = openai_client.responses.create(
        input=message,
        extra_body={"agent": {"name": AGENTS[agent_type]["name"], "type": "agent_reference"}},
    )
    print(response.output_text)


def delete() -> None:
    client = _project_client()
    for spec in AGENTS.values():
        try:
            client.agents.delete(agent_name=spec["name"])
            print(f"deleted {spec['name']}")
        except Exception as exc:  # noqa: BLE001 - keep going; report per agent
            print(f"skipped {spec['name']}: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage the Liftoff agents on Azure AI Foundry.")
    sub = parser.add_subparsers(dest="command", required=True)
    p_create = sub.add_parser("create", help="create or update all agents")
    p_create.add_argument("--dry-run", action="store_true", help="print the plan without calling Azure")
    sub.add_parser("list", help="list agents in the project")
    p_chat = sub.add_parser("chat", help="send one message to an agent")
    p_chat.add_argument("agent", choices=list(AGENTS))
    p_chat.add_argument("message")
    sub.add_parser("delete", help="delete the Liftoff agents")
    args = parser.parse_args()

    if args.command == "create":
        create(dry_run=args.dry_run)
    elif args.command == "list":
        list_agents()
    elif args.command == "chat":
        chat(args.agent, args.message)
    elif args.command == "delete":
        delete()


if __name__ == "__main__":
    main()
