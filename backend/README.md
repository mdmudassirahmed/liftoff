# Liftoff backend

FastAPI service behind the Liftoff canvas. It runs five agents (system prompts in
`app/agents/prompts.py`) on the chat model you configure to turn diagrams into IaC,
checks the output against security guardrails, and runs What-If and deployments with
the Azure CLI. See the [root README](../README.md)
for the full picture.

## Run

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # optional - everything has a safe default
uvicorn main:app --reload     # http://127.0.0.1:8000  (API docs at /docs)
```

The server binds to `127.0.0.1` by default. Deploy endpoints act with **your**
`az login` identity, so keep it on loopback unless you put authentication in
front of it (set `API_AUTH_TOKEN`, see [SECURITY.md](../SECURITY.md)).

## Configuration

All settings live in `app/core/config.py` and are read from environment
variables or `backend/.env`. See [`.env.example`](.env.example) for the full list.

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_PROVIDER` | `auto` | `openai`, `azure-openai`, `foundry` or `none`; `auto` picks the first configured option below |
| `AI_MODEL` | `gpt-4.1` | Model name for OpenAI-compatible providers (and the Azure OpenAI deployment fallback) |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | *(empty)* | OpenAI, or any OpenAI-compatible server (Ollama: `http://localhost:11434/v1`) |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY` | *(empty)* | Azure OpenAI; keyless through `az login` unless the key is set |
| `AZURE_AI_PROJECT_ENDPOINT` | *(empty)* | Azure AI Foundry project hosting the agents created by `agents/create_agents.py` |
| `CORS_ORIGINS` | localhost:5173 / 4173 | Browser origins allowed to call the API |
| `ALLOWED_HOSTS` | localhost, 127.0.0.1 | Host-header allow-list (DNS-rebinding protection) |
| `API_AUTH_TOKEN` | *(empty)* | Require `Authorization: Bearer <token>` on `/api/*` |
| `GUARDRAILS_ENABLED` | `true` | Inject security guardrails into prompts and return a compliance report |
| `IAC_REFERENCE_EXISTING_NETWORKS` | `false` | Landing-zone mode: reference existing VNets instead of creating them |

With no provider configured the AI endpoints return HTTP 503 with guidance and
everything else works. Azure providers are reached keylessly with
`DefaultAzureCredential` unless you set a key.

## API

Interactive docs: `http://127.0.0.1:8000/docs`.

| Area | Endpoints |
|------|-----------|
| AI agents | `POST /api/agents/diagram/generate`, `/iac/generate`, `/iac/validate`, `/security/analyze`, `/docs/search`, `/chat` |
| Advisor chat | `POST /api/chat`, `/api/chat/stream`, `/api/chat/advisor`, `/api/chat/advisor/stream` |
| IaC | `POST /api/iac/generate`, `POST /api/iac/validate`, `GET /api/iac/status` |
| Deploy (Azure CLI) | `GET /api/deploy/status`, `/subscriptions`, `/resource-groups`; `POST /api/deploy/what-if`, `/what-if/stream`, `/validate`, `/`, `/logout` |
| Health | `GET /health`, `/api/health`, `/api/health/live`, `/api/health/ready`, `/api/health/agents` |

## Guardrails

`app/data/guardrails/azure_guardrails.json` holds 100+ controls mapped to the
Microsoft Cloud Security Benchmark and built-in Azure Policy definitions. It is
generated from `scripts/build_guardrail_catalog.py`. To add a control, edit
that script and run `python scripts/build_guardrail_catalog.py`.

`app/services/guardrails.py` matches controls to the diagram, injects
enforceable secure properties into the generation prompt, and runs
deterministic checks over the generated templates.

## Test

```bash
pip install -r requirements-dev.txt
pytest          # no Azure access needed: Foundry and az are faked
ruff check .
```

## Layout

```
app/
├── agents/foundry/   Foundry client (prompts, Bicep auto-fix loop) + registry
├── api/endpoints/    agents, chat, iac, deploy, health
├── core/             settings, logging, request guard middleware
├── data/guardrails/  guardrail catalog + service map
├── mcp/              Microsoft Learn docs tool
├── models/           Pydantic request/response models
└── services/         guardrail matching, prompt constraints, compliance report
scripts/              build_guardrail_catalog.py
tests/                pytest suite
```
