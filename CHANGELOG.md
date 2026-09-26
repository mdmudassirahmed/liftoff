# Changelog

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
