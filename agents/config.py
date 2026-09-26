"""
Configuration module for Azure AI Foundry Agents.
Loads environment variables and provides centralized config access.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from this directory
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)

# Set OPENAI_API_VERSION for the OpenAI client (required for conversations/responses API)
os.environ["OPENAI_API_VERSION"] = os.getenv("OPENAI_API_VERSION", "2024-10-21")

# =============================================================================
# Required Configuration
# =============================================================================

PROJECT_ENDPOINT = os.getenv("AZURE_AI_PROJECT_ENDPOINT")
MODEL_DEPLOYMENT = os.getenv("AZURE_AI_MODEL_DEPLOYMENT_NAME", "gpt-4.1")

# =============================================================================
# MCP Server Configuration
# =============================================================================

# Microsoft Learn MCP Server (public, no authentication required)
MCP_MICROSOFT_LEARN_URL = os.getenv("MCP_MICROSOFT_LEARN_URL", "https://learn.microsoft.com/api/mcp")

# GitHub MCP Server (requires authentication via project connection)
MCP_GITHUB_URL = os.getenv("MCP_GITHUB_URL", "https://api.githubcopilot.com/mcp")

# Project Connection for authenticated MCP servers
MCP_PROJECT_CONNECTION_NAME = os.getenv("MCP_PROJECT_CONNECTION_NAME")

# =============================================================================
# Output Files
# =============================================================================

AGENTS_INFO_FILE = Path(__file__).parent / "agents_info.json"

# =============================================================================
# Validation
# =============================================================================

def validate_config() -> bool:
    """Validate required configuration is present."""
    errors = []
    
    if not PROJECT_ENDPOINT:
        errors.append("AZURE_AI_PROJECT_ENDPOINT is not set")
    elif not PROJECT_ENDPOINT.startswith("https://"):
        errors.append("AZURE_AI_PROJECT_ENDPOINT must start with https://")
    elif "services.ai.azure.com/api/projects" not in PROJECT_ENDPOINT:
        errors.append("AZURE_AI_PROJECT_ENDPOINT should contain 'services.ai.azure.com/api/projects'")
    
    if not MODEL_DEPLOYMENT:
        errors.append("AZURE_AI_MODEL_DEPLOYMENT_NAME is not set")
    
    if errors:
        print("\nConfiguration Errors:")
        for error in errors:
            print(f"   - {error}")
        print("\nPlease check your .env file.")
        return False
    
    return True


def print_config():
    """Print current configuration (masked)."""
    print("\nCurrent Configuration:")
    print("-" * 50)
    
    # Mask the endpoint for display
    if PROJECT_ENDPOINT:
        parts = PROJECT_ENDPOINT.split("/")
        masked = f"{parts[0]}//{parts[2][:20]}.../{parts[-1]}"
        print(f"  Project Endpoint: {masked}")
    else:
        print("  Project Endpoint: NOT SET")
    
    print(f"  Model Deployment: {MODEL_DEPLOYMENT}")
    print(f"  OpenAI API Version: {os.environ.get('OPENAI_API_VERSION', 'NOT SET')}")
    print()
    print("  MCP Servers:")
    print(f"    - Microsoft Learn: {MCP_MICROSOFT_LEARN_URL}")
    print(f"    - GitHub: {MCP_GITHUB_URL}")
    if MCP_PROJECT_CONNECTION_NAME:
        print(f"    - Project Connection: {MCP_PROJECT_CONNECTION_NAME}")
    print("-" * 50)


if __name__ == "__main__":
    print_config()
    if validate_config():
        print("\nConfiguration is valid!")
    else:
        print("\nConfiguration has errors!")
