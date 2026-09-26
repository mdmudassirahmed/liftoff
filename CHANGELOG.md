# Changelog

## 1.2.0

- AWS support: AWS palette (32 services), prompt-to-diagram for AWS, CloudFormation generation with modular output (root template, per-service modules, dev/test/prod parameters) and change-set deployment
- AWS guardrails: 31 controls mapped to AWS Foundational Security Best Practices and AWS Config rules, with deterministic CloudFormation checks
- CloudFormation is validated with cfn-lint and errors are sent back to the model for correction
- CloudFormation-aware YAML handling (`!Ref`, `!Sub`, `!GetAtt`, ...) so post-processing and modular splitting work on real model output
- Architecture advisor grounded in the Microsoft Learn MCP server (real MCP Streamable HTTP client) for every AI provider, with source links in the chat
- The active cloud follows the diagram: importing or generating an AWS diagram switches the palette and IaC format automatically
- Example: `examples/aws-serverless-api.json`; deep links accept `&cloud=aws`
- The Create from Prompt dialog has an Azure / AWS choice with cloud-specific examples (it previously used the cloud of the open project, so an AWS prompt from an Azure project produced an Azure diagram)
- Fix: switching tabs, importing or generating a diagram no longer overwrites the tab you were on
- Demo GIF and screenshots of generated code, the guardrail report and the advisor, from a real run
- One source of truth for the seven agents, including a dedicated diagram generator for Azure and AWS (diagram requests previously went to the Bicep agent, which strong models refused for AWS) (`backend/app/agents/prompts.py`); the separate `agents/` folder is replaced by an optional `backend/scripts/foundry_agents.py` (create, list, chat, delete) for Azure AI Foundry users

## 1.1.0

- Bring your own model: the agents now run on OpenAI, Azure OpenAI, any OpenAI-compatible server (Ollama, LM Studio, vLLM) or Azure AI Foundry, selected in `backend/.env` (`AI_PROVIDER`)
- Agent system prompts live in the backend (`app/agents/prompts.py`) and are shared across providers
- Deep links open bundled examples directly (`/workspace?example=web-app-sql&select=web`, `&panel=issues`, `?prompt=1`)
- Live screenshots in the README
- First-run fixes: executable `dev.sh`, Windows launch command, `127.0.0.1` defaults, strict Vite port, clear "Azure CLI not found" message

## 1.0.0 - first public release

- Visual Azure architecture canvas with live Bicep-schema property editing
- Prompt-to-diagram and modular Bicep / Terraform / ARM generation with Azure AI Foundry agents
- Security guardrail catalog (100+ controls mapped to MCSB and Azure Policy) with compliance report
- Bicep compile + automatic correction loop
- Streaming What-If preview and one-click deploy with the Azure CLI
- Architecture advisor grounded in Microsoft Learn (MCP)
- Hardened local API: loopback binding, origin/host checks, optional token, validated CLI arguments
- Backend (pytest) and frontend (Vitest) test suites with CI
