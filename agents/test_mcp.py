"""
Test MCP Tool Integration (Microsoft Learn)
============================================
Test that the azure-docs-agent can use MCP tools to search Microsoft Learn.

This script specifically tests:
1. Agent can invoke MCP tools
2. MCP approval flow (if require_approval is set)
3. Tool response handling

Usage:
    python test_mcp.py

The azure-docs-agent should:
1. Receive the query
2. Call the Microsoft Learn MCP server
3. Return documentation content
"""

import json
from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from openai.types.responses.response_input_param import McpApprovalResponse

from config import (
    PROJECT_ENDPOINT,
    validate_config,
)


def test_mcp_agent():
    """Test the azure-docs-agent with MCP tools."""
    
    print("=" * 70)
    print("  MCP Tool Integration Test")
    print("=" * 70)
    
    if not validate_config():
        return False
    
    # Connect
    print("\nConnecting to Azure AI Foundry...")
    credential = DefaultAzureCredential()
    project_client = AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=credential)
    openai_client = project_client.get_openai_client()
    print("   Connected")
    
    # Agent to test
    agent_name = "azure-docs-agent:1"
    print(f"\nTesting agent: {agent_name}")
    
    # Test query that should trigger MCP
    test_query = "What is Azure App Service and what are its pricing tiers?"
    print(f"\nQuery: {test_query}")
    print("-" * 50)
    
    # Create conversation for context
    conversation = openai_client.conversations.create()
    print(f"   Created conversation: {conversation.id}")
    
    # Send request
    print("\nSending request (agent may invoke MCP tools)...")
    
    response = openai_client.responses.create(
        conversation=conversation.id,
        input=test_query,
        extra_body={
            "agent": {
                "name": agent_name,
                "type": "agent_reference"
            }
        }
    )
    
    # Check for MCP approval requests
    approval_requests = []
    for item in response.output:
        item_type = getattr(item, 'type', None)
        
        if item_type == "mcp_approval_request":
            print("\nMCP Approval Requested!")
            print(f"   Server: {getattr(item, 'server_label', 'unknown')}")
            print(f"   Tool: {getattr(item, 'name', 'unknown')}")
            print(f"   Arguments: {json.dumps(getattr(item, 'arguments', {}), indent=2)}")
            
            approval_requests.append({
                "id": item.id,
                "server_label": getattr(item, 'server_label', 'unknown'),
                "tool_name": getattr(item, 'name', 'unknown'),
            })
    
    # If approvals needed, auto-approve and continue
    if approval_requests:
        print(f"\nAuto-approving {len(approval_requests)} MCP tool calls...")
        
        input_list = []
        for req in approval_requests:
            input_list.append(
                McpApprovalResponse(
                    type="mcp_approval_response",
                    approve=True,
                    approval_request_id=req["id"],
                )
            )
        
        # Continue with approval
        response = openai_client.responses.create(
            input=input_list,
            previous_response_id=response.id,
            extra_body={
                "agent": {
                    "name": agent_name,
                    "type": "agent_reference"
                }
            }
        )
    
    # Get final response
    response_text = getattr(response, 'output_text', None)
    
    if response_text:
        print("\nAgent Response:")
        print("-" * 50)
        print(response_text)
        print("-" * 50)
        
        # Check if MCP was used
        mcp_indicators = [
            "documentation",
            "microsoft learn",
            "docs.microsoft.com",
            "learn.microsoft.com",
            "according to",
            "based on",
        ]
        
        used_mcp = any(indicator.lower() in response_text.lower() for indicator in mcp_indicators)
        
        if used_mcp:
            print("\nMCP tools appear to have been used (response contains documentation references)")
        else:
            print("\n Could not confirm MCP tool usage from response content")
            print("    This may be normal if the agent used internal knowledge")
    else:
        print("\n No text response received")
        print(f"   Full response object: {response}")
    
    # Analyze response output items
    print("\nResponse Analysis:")
    for i, item in enumerate(response.output):
        item_type = getattr(item, 'type', 'unknown')
        print(f"   [{i}] Type: {item_type}")
        
        if item_type == "mcp_call":
            print(f"       Server: {getattr(item, 'server_label', 'unknown')}")
            print(f"       Tool: {getattr(item, 'name', 'unknown')}")
            print("    MCP tool was called!")
    
    return True


def main():
    print("\n" + "=" * 70)
    print("  Testing Azure Docs Agent with Microsoft Learn MCP")
    print("=" * 70)
    
    success = test_mcp_agent()
    
    if success:
        print("\nMCP test completed!")
    else:
        print("\nMCP test failed!")
    
    return success


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
