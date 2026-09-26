"""
Delete All Agents
=================
Deletes all agents created by create_agents.py from Azure AI Foundry.

Usage:
    python delete_agents.py           # Delete agents from agents_info.json
    python delete_agents.py --all     # Delete ALL agents in the project
    python delete_agents.py --name azure-docs-agent  # Delete specific agent
"""

import argparse
import json
from pathlib import Path

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient

from config import (
    PROJECT_ENDPOINT,
    AGENTS_INFO_FILE,
    validate_config,
)


def delete_specific_agent(project_client, agent_name: str, agent_version: int = None):
    """Delete a specific agent by name and optionally version."""
    try:
        if agent_version:
            project_client.agents.delete_version(agent_name=agent_name, agent_version=agent_version)
            print(f"  Deleted: {agent_name} (v{agent_version})")
        else:
            # Delete all versions of this specific agent
            try:
                versions = list(project_client.agents.list_versions(agent_name=agent_name))
                if versions:
                    for agent in versions:
                        version = getattr(agent, 'version', 1)
                        project_client.agents.delete_version(agent_name=agent_name, agent_version=version)
                        print(f"  Deleted: {agent_name} (v{version})")
                else:
                    # Try deleting version 1 as fallback
                    project_client.agents.delete_version(agent_name=agent_name, agent_version=1)
                    print(f"  Deleted: {agent_name} (v1)")
            except Exception as version_error:
                # Fallback: try to delete without version or with common versions
                try:
                    project_client.agents.delete_version(agent_name=agent_name, agent_version=1)
                    print(f"  Deleted: {agent_name} (v1)")
                except:
                    print(f"   Agent not found or already deleted: {agent_name}")
        return True
    except Exception as e:
        print(f"  Failed to delete {agent_name}: {e}")
        return False


def delete_from_info_file(project_client):
    """Delete all agents listed in agents_info.json."""
    if not AGENTS_INFO_FILE.exists():
        print("agents_info.json not found. Nothing to delete.")
        return False
    
    with open(AGENTS_INFO_FILE) as f:
        info = json.load(f)
    
    print("\n Deleting agents from agents_info.json...")
    print("-" * 50)
    
    success_count = 0
    for key, agent in info.get("agents", {}).items():
        agent_name = agent.get("agent_name")
        agent_version = agent.get("agent_version")
        
        if agent_name:
            if delete_specific_agent(project_client, agent_name, agent_version):
                success_count += 1
    
    print(f"\nDeleted {success_count} agents")
    
    # Remove the info file
    AGENTS_INFO_FILE.unlink()
    print(f"Removed: {AGENTS_INFO_FILE}")
    
    return True


def delete_all_agents(project_client):
    """Delete ALL agents in the project."""
    print("\n Deleting ALL agents in project...")
    print("-" * 50)
    
    # List all agents (not versions)
    agents = list(project_client.agents.list())
    
    if not agents:
        print("  No agents found in project.")
        return True
    
    print(f"  Found {len(agents)} agent(s)")
    
    success_count = 0
    for agent in agents:
        agent_name = getattr(agent, 'name', None)
        
        if agent_name:
            if delete_specific_agent(project_client, agent_name):
                success_count += 1
    
    print(f"\nDeleted {success_count} agents")
    
    # Remove info file if exists
    if AGENTS_INFO_FILE.exists():
        AGENTS_INFO_FILE.unlink()
        print(f"Removed: {AGENTS_INFO_FILE}")
    
    return True


def main():
    parser = argparse.ArgumentParser(description="Delete Azure AI Foundry Agents")
    parser.add_argument("--all", action="store_true", help="Delete ALL agents in the project")
    parser.add_argument("--name", type=str, help="Delete a specific agent by name")
    parser.add_argument("--version", type=int, help="Specific version to delete (use with --name)")
    args = parser.parse_args()
    
    print("=" * 70)
    print("  Azure AI Foundry Agent Deletion")
    print("=" * 70)
    
    if not validate_config():
        return False
    
    # Connect
    print("\nConnecting to Azure AI Foundry...")
    credential = DefaultAzureCredential()
    project_client = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=credential)
    print("   Connected")
    
    if args.name:
        # Delete specific agent
        print(f"\nDeleting agent: {args.name}")
        delete_specific_agent(project_client, args.name, args.version)
    elif args.all:
        # Delete all agents
        confirm = input("\n This will delete ALL agents. Type 'yes' to confirm: ")
        if confirm.lower() == 'yes':
            delete_all_agents(project_client)
        else:
            print("Cancelled.")
    else:
        # Delete from info file
        delete_from_info_file(project_client)
    
    print("\nDone!")
    return True


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
