"""
Test Agent Communication (New Foundry API)
==========================================
Test chatting with agents created in NEW Microsoft Foundry.

Usage:
    python test_agent.py                    # Interactive mode
    python test_agent.py --agent azure-docs-agent  # Test specific agent
    python test_agent.py --list             # List all agents

This script uses the NEW Foundry responses API:
    openai_client.responses.create(
        input="...",
        extra_body={"agent": {"name": agent_name, "type": "agent_reference"}}
    )
"""

import argparse
import json
from pathlib import Path

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient

from config import (
    PROJECT_ENDPOINT,
    MODEL_DEPLOYMENT,
    AGENTS_INFO_FILE,
    validate_config,
)


def load_agents_info() -> dict:
    """Load agent information from JSON file."""
    if not AGENTS_INFO_FILE.exists():
        print(f"Agents info file not found: {AGENTS_INFO_FILE}")
        print("   Run 'python create_agents.py' first.")
        return None
    
    with open(AGENTS_INFO_FILE) as f:
        return json.load(f)


def list_agents():
    """List all created agents."""
    info = load_agents_info()
    if not info:
        return
    
    print("\nAvailable Agents:")
    print("-" * 60)
    
    for key, agent in info["agents"].items():
        name = agent["agent_name"]
        version = agent["agent_version"]
        has_mcp = agent.get("has_mcp", False)
        mcp_indicator = "MCP" if has_mcp else ""
        
        print(f"  • {name}:{version} {mcp_indicator}")
        print(f"    Capabilities: {', '.join(agent.get('capabilities', []))}")
        print()


def chat_with_agent(agent_name: str, message: str, openai_client, conversation_id: str = None) -> tuple:
    """
    Send a message to an agent and get response.
    
    Returns:
        tuple: (response_text, conversation_id, response_object)
    """
    # Parse agent name and version
    if ":" in agent_name:
        name_only, version = agent_name.split(":", 1)
    else:
        name_only = agent_name
        version = None
    
    # Build agent reference - use name only, version separately if needed
    agent_ref = {
        "name": name_only,
        "type": "agent_reference"
    }
    if version:
        agent_ref["version"] = version
    
    extra_body = {
        "agent": agent_ref
    }
    
    kwargs = {
        "input": message,
        "extra_body": extra_body,
    }
    
    if conversation_id:
        kwargs["conversation"] = conversation_id
    
    response = openai_client.responses.create(**kwargs)
    
    # Extract response text
    response_text = getattr(response, 'output_text', None)
    if not response_text:
        # Try to extract from output items
        for item in getattr(response, 'output', []):
            if hasattr(item, 'content'):
                for content in item.content:
                    if hasattr(content, 'text'):
                        response_text = content.text
                        break
    
    # Get conversation ID for multi-turn
    conv_id = getattr(response, 'conversation_id', None)
    
    return response_text, conv_id, response


def interactive_chat(agent_name: str, openai_client):
    """Interactive chat session with an agent."""
    print(f"\nStarting chat with: {agent_name}")
    print("   Type 'quit' or 'exit' to end the conversation")
    print("   Type 'clear' to start a new conversation")
    print("-" * 50)
    
    conversation_id = None
    
    while True:
        try:
            user_input = input("\nYou: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\n\nGoodbye!")
            break
        
        if not user_input:
            continue
        
        if user_input.lower() in ['quit', 'exit']:
            print("\nGoodbye!")
            break
        
        if user_input.lower() == 'clear':
            conversation_id = None
            print("Started new conversation")
            continue
        
        print("\nAgent: ", end="", flush=True)
        
        try:
            response_text, conversation_id, response = chat_with_agent(
                agent_name, 
                user_input, 
                openai_client,
                conversation_id
            )
            
            if response_text:
                print(response_text)
            else:
                print("[No text response received]")
                print(f"   Full response: {response}")
                
        except Exception as e:
            print(f"\nError: {e}")
            import traceback
            traceback.print_exc()


def test_single_message(agent_name: str, message: str, openai_client):
    """Send a single test message to an agent."""
    print(f"\nTesting: {agent_name}")
    print(f"   Message: {message}")
    print("-" * 50)
    
    try:
        response_text, _, _ = chat_with_agent(agent_name, message, openai_client)
        print(f"\nResponse:")
        print(response_text if response_text else "[No response]")
    except Exception as e:
        print(f"\nError: {e}")


def main():
    parser = argparse.ArgumentParser(description="Test Azure AI Foundry Agents")
    parser.add_argument("--list", action="store_true", help="List all agents")
    parser.add_argument("--agent", type=str, help="Agent name to chat with")
    parser.add_argument("--message", type=str, help="Single message to send (non-interactive)")
    args = parser.parse_args()
    
    if args.list:
        list_agents()
        return
    
    # Validate config
    if not validate_config():
        return
    
    # Connect to Azure
    print("Connecting to Azure AI Foundry...")
    credential = DefaultAzureCredential()
    project_client = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=credential)
    openai_client = project_client.get_openai_client()
    print("   Connected")
    
    # Load agents
    info = load_agents_info()
    if not info:
        return
    
    # Determine which agent to use
    if args.agent:
        agent_name = args.agent
        # Add version if not specified
        if ":" not in agent_name:
            # Find the agent in our info
            for key, agent in info["agents"].items():
                if agent["agent_name"] == agent_name:
                    agent_name = f"{agent_name}:{agent['agent_version']}"
                    break
    else:
        # Default to first agent
        first_agent = list(info["agents"].values())[0]
        agent_name = f"{first_agent['agent_name']}:{first_agent['agent_version']}"
    
    print(f"\nUsing agent: {agent_name}")
    
    if args.message:
        # Single message mode
        test_single_message(agent_name, args.message, openai_client)
    else:
        # Interactive mode
        interactive_chat(agent_name, openai_client)


if __name__ == "__main__":
    main()
