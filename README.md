# Liftoff

**From idea to liftoff. Type a sentence, get a secure Azure or AWS architecture you can actually deploy.**

[![CI](https://github.com/mdmudassirahmed/liftoff/actions/workflows/ci.yml/badge.svg)](https://github.com/mdmudassirahmed/liftoff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![IaC](https://img.shields.io/badge/IaC-Bicep%20%7C%20Terraform%20%7C%20ARM%20%7C%20CloudFormation-0078D4)
![Guardrails](https://img.shields.io/badge/guardrails-137%20controls-2E7D32)

![The Liftoff workspace: a web app architecture on the canvas, with the service palette on the left and the properties panel on the right](docs/images/canvas.png)

Liftoff is an open-source architecture designer for **Azure and AWS**. Describe a system
in plain English or draw it on a canvas, and Liftoff turns it into modular Bicep,
Terraform or CloudFormation that is **hardened against security guardrails, validated
before you see it, and previewed before anything touches your cloud.**

It runs on your machine, deploys with your own cloud credentials, and works with the model
you already have: OpenAI, Azure OpenAI, a local model through Ollama or LM Studio, or
Azure AI Foundry.

[Quick start](#quick-start) &nbsp;|&nbsp; [First session](#a-first-session) &nbsp;|&nbsp; [How it works](#how-it-works) &nbsp;|&nbsp; [FAQ](#faq) &nbsp;|&nbsp; [Contributing](CONTRIBUTING.md)

## Why Liftoff

| The usual way | With Liftoff |
|---------------|---------------|
| A diagram in one tool, templates in another, drifting apart | The diagram *is* the source of the templates |
| Looking up every property name and API version in the docs | Property panels come straight from Azure's own Bicep type definitions |
| AI-written templates that invent properties and fail to compile | Output is compiled with `az bicep build`, and compiler errors are sent back for automatic correction |
| Public endpoints and shared keys left on by default | HTTPS-only, TLS 1.2, private access, managed identity and RBAC baked into every prompt |
| "What will this actually change?" answered after the deploy | A streamed What-If preview of every create, modify and delete, first |
| Security review as a separate, late step | A per-template report showing which controls are enforced |

> Every architecture starts as an idea on a whiteboard. Liftoff is the moment it leaves
> the ground: designed, secured, checked and running in Azure.

## What happens at each step

The diagram is the source of truth, and every stage has its own check:

| Step | What Liftoff does |
|------|--------------------|
| Design | Property panels are built from the live [Azure Bicep type definitions](https://github.com/Azure/bicep-types-az), so fields, allowed values and required flags match what Azure Resource Manager accepts. Missing dependencies are flagged as you draw. |
| Generate | Before the model writes a line, the prompt is loaded with exact secure settings for every resource in the diagram: HTTPS only, TLS 1.2, no anonymous blob access, purge protection, managed identity with least-privilege RBAC, private connectivity. |
| Verify | Output is compiled with `az bicep build`. Compiler errors go back to the model for up to two correction rounds. Deterministic checks then report which security controls the template actually enforces. |
| Deploy | An Azure What-If run streams every create, modify and delete to the UI before anything is applied. |

## What you get

Generate from the bundled web app example and you get a modular project like this:

```
main.bicep                        orchestrates the modules
parameters/dev.parameters.json    environment parameters
modules/compute/appServicePlan.bicep
modules/compute/webApp.bicep
modules/database/sqlServer.bicep
modules/security/keyVault.bicep
modules/storage/storageAccount.bicep
README.md                         deployment steps for this template
```

with resources hardened by default (abridged):

```bicep
resource storage 'Microsoft.Storage/storageAccounts@2022-09-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', bypass: 'AzureServices' }
  }
}
```

and a compliance report alongside it:

| Control | Resource | Status |
|---------|----------|--------|
| LFT-STG-01 Secure transfer required | Storage account | Enforced |
| LFT-STG-02 Anonymous blob access disabled | Storage account | Enforced |
| LFT-KV-01 Purge protection enabled | Key Vault | Enforced |
| LFT-WEB-01 HTTPS only | Web App | Enforced |
| LFT-SQL-02 Entra-only authentication | SQL server | Recommended |

Every control maps to a [Microsoft Cloud Security Benchmark](https://learn.microsoft.com/security/benchmark/azure/)
control and, where one exists, the built-in Azure Policy that audits it.

## Screenshots

**Properties come from Azure's own schema.** Select a resource and the panel shows its
real properties (56 for a Web App), with required fields called out first.

![Properties panel showing the Web App's schema-driven properties](docs/images/properties.png)

**Problems surface while you design.** The Issues panel flags missing required and
recommended dependencies and offers the fix.

![Issues panel listing missing dependencies for an AKS architecture](docs/images/issues.png)

**Start from a sentence.** Describe the architecture and Liftoff generates the diagram.

![Create from Prompt dialog](docs/images/prompt.png)

**AWS too.** Switch the palette to AWS, or import an AWS diagram, and the same canvas
works with CloudFormation resource types, an AWS properties panel and AWS guardrails.

![An AWS serverless API on the canvas with the CloudFormation properties panel](docs/images/aws-canvas.png)

**The landing page.**

![Liftoff landing page](docs/images/landing.png)

The whole flow at a glance:

![Liftoff workflow: describe, design, generate, deploy](docs/images/overview.svg)

## Features

- **Prompt to diagram.** "A Python web app with a private SQL database, Key Vault and
  Application Insights" becomes a nested region, subscription, resource group and
  services layout you can edit.
- **Visual designer.** 85 Azure services and 32 AWS services, grouping by region,
  subscription, resource group, virtual network and subnet (Azure) or account and region
  (AWS), with properties inherited down the hierarchy.
- **Schema-driven properties.** Required fields first, enums as dropdowns, current
  API versions, straight from the Bicep type definitions.
- **Architecture validation.** An App Service without a plan, a private endpoint
  without a network, and similar gaps show up in the Issues panel.
- **Modular IaC.** Azure: Bicep by default, Terraform and ARM on request. AWS:
  CloudFormation with a root template, per-service modules and dev/test/prod parameter
  files. Everything downloads as a ZIP.
- **Security guardrails.** 137 controls: 106 for Azure mapped to the Microsoft Cloud
  Security Benchmark and Azure Policy, 31 for AWS mapped to AWS Foundational Security
  Best Practices and AWS Config rules, with a pass/fail report per template.
- **Validated output.** Bicep is compiled with `az bicep build`; CloudFormation is
  checked with `cfn-lint`. Errors go back to the model for correction.
- **Preview and deploy.** Azure: streaming What-If, then `az deployment group create`.
  AWS: a CloudFormation change set with a lint gate.
- **Architecture advisor.** A chat assistant that sees the diagram on your canvas. For
  Azure, answers are grounded in current documentation fetched live from the
  **Microsoft Learn MCP server**, with source links.
- **Landing-zone mode.** For estates where a platform team owns networking, generated
  code references existing virtual networks instead of creating them.

## Quick start

Requirements: Node.js 20 or later and Python 3.10 or later. The
[Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) is needed only for
What-If and deployment.

```bash
git clone https://github.com/mdmudassirahmed/liftoff.git
cd liftoff

./scripts/dev.sh                                             # macOS / Linux
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1   # Windows
```

The script installs dependencies on the first run and starts both services. Open
**http://localhost:5173**. The API and its interactive docs are at
http://127.0.0.1:8000/docs.

<details>
<summary>Starting the backend and frontend separately</summary>

```bash
# Terminal 1: backend
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload

# Terminal 2: frontend
cd frontend
npm install
npm run dev
```

</details>

No configuration is required to start.

### What works without any Azure setup

| Capability | Requirement |
|------------|-------------|
| Canvas, service palette, grouping, drag and drop | None |
| Importing the [examples](examples/) or your own diagram JSON | None |
| Schema-driven property editor | Internet access (public Bicep type definitions) |
| Dependency validation and the Issues panel | None |
| Saving to the browser and exporting diagram JSON | None |
| Prompt to diagram, IaC generation, guardrail report, advisor chat | Any chat model: an OpenAI key, Azure OpenAI, a local model, or Azure AI Foundry ([setup](#enabling-the-ai-features)) |
| Azure What-If preview and deployment | Azure CLI signed in with `az login` |
| AWS CloudFormation deployment | `pip install -r backend/requirements-aws.txt` and AWS credentials (profile, SSO or environment) |

## A first session

1. On the landing page choose **Get Started** to open the workspace.
2. Load an example. The quickest way is a deep link, which opens the example directly:

   - http://localhost:5173/workspace?example=web-app-sql
   - http://localhost:5173/workspace?example=serverless-ai
   - http://localhost:5173/workspace?example=aks-microservices
   - http://localhost:5173/workspace?example=aws-serverless-api (AWS)

   Add `&select=web` to open a resource's properties, or `&panel=issues` to open the
   Issues panel. You can also click **+** next to the tabs, choose **Import from JSON**,
   and load a file from `examples/`:

   | File | Architecture |
   |------|--------------|
   | [`examples/web-app-sql.json`](examples/web-app-sql.json) | Python web app on App Service with Azure SQL, Key Vault, Storage and Application Insights |
   | [`examples/serverless-ai.json`](examples/serverless-ai.json) | Function App with Azure OpenAI, Cosmos DB, Service Bus, Key Vault and Storage |
   | [`examples/aks-microservices.json`](examples/aks-microservices.json) | AKS behind an Application Gateway WAF, with Container Registry, PostgreSQL, Redis and workload identity |
   | [`examples/aws-serverless-api.json`](examples/aws-serverless-api.json) | AWS: API Gateway, Lambda, DynamoDB, SQS, S3 and Secrets Manager |

3. Select any resource. The properties panel on the right shows its real Azure
   properties, loaded from the Bicep schema.
4. Delete the App Service Plan in the web app example. The Issues panel reports that
   the Web App has lost a required dependency. Add a plan back from the palette.
5. With AI enabled, choose **Generate IaC**, pick Bicep or Terraform, and leave modular
   output on. Review the files and the guardrail report.
6. Signed in to Azure, select a subscription and an existing resource group, run
   **What-If**, read the planned changes, then **Deploy**.
7. Open the advisor chat and ask something about the diagram, for example
   *"How would I make this zone-redundant?"*

To start from a sentence instead, choose **+** then **Create from Prompt** and try:

- *A Python web app on App Service with a private Azure SQL database, Key Vault for secrets and Application Insights.*
- *An event-driven order pipeline: a Function App triggered by Service Bus, writing to Cosmos DB, with Storage for receipts.*
- *A retrieval-augmented chatbot with App Service, Azure OpenAI, Azure AI Search and a Storage account for documents in West Europe.*
- *Three microservices on AKS behind an Application Gateway with WAF, pulling images from a private Container Registry.*

Switch the palette to **AWS** first to generate AWS diagrams, for example:

- *A serverless orders API: API Gateway, a Lambda function, a DynamoDB table, an SQS queue for events and an S3 bucket for receipts.*

## Enabling the AI features

Diagram generation, IaC generation and the advisor are six specialised agents
(orchestrator, IaC generator, AWS IaC generator, documentation, security advisor,
validator). Each is a
system prompt that runs on whichever chat model you configure. Copy
`backend/.env.example` to `backend/.env`, set **one** of the options below, and restart
the backend.

| Provider | Settings in `backend/.env` |
|----------|----------------------------|
| **OpenAI** | `OPENAI_API_KEY=sk-...` and optionally `AI_MODEL=gpt-4.1` |
| **Local model** (Ollama, LM Studio, vLLM, any OpenAI-compatible server) | `OPENAI_BASE_URL=http://localhost:11434/v1` and `AI_MODEL=llama3.1` (Ollama example) |
| **Azure OpenAI** | `AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/` and `AZURE_OPENAI_DEPLOYMENT=<deployment>`. Keyless through `az login`, or set `AZURE_OPENAI_API_KEY` |
| **Azure AI Foundry agents** | `AZURE_AI_PROJECT_ENDPOINT=...` after creating the agents once with `agents/create_agents.py` (keyless through `az login`) |

`AI_PROVIDER=auto` (the default) uses the first option that is set; set it to `openai`,
`azure-openai` or `foundry` to choose explicitly. Until a provider is configured, AI
endpoints return HTTP 503 with instructions and the rest of the application keeps
working.

Generation quality depends on the model. The Bicep compile-and-correct loop and the
deterministic guardrail checks apply to every provider, so weaker models still produce
templates that compile and are verified; they may just need more correction rounds.

## How it works

```mermaid
flowchart LR
    subgraph Browser["Browser: React and React Flow"]
        Canvas[Canvas and palette]
        Props[Schema-driven properties]
        Preview[IaC preview and guardrail report]
    end

    subgraph API["FastAPI backend on 127.0.0.1"]
        Guard[Request guard: origin, host, token]
        Rails[Guardrail engine]
        Fix[Validate and correct: az bicep build / cfn-lint]
        Deploy[Azure What-If / AWS change set]
    end

    subgraph Model["Your AI provider"]
        LLM[OpenAI · Azure OpenAI · local model · Azure AI Foundry]
    end

    subgraph Clouds
        ARM[Azure Resource Manager]
        CFN[AWS CloudFormation]
    end

    Learn[(Microsoft Learn MCP server)]

    BicepTypes[(Azure/bicep-types-az)]

    Canvas --> Guard
    Props -. live schemas .-> BicepTypes
    Guard --> Rails --> LLM
    LLM --> Fix --> Preview
    Preview --> Deploy -->|az CLI| ARM
    Deploy -->|boto3| CFN
    LLM -. advisor grounding .-> Learn
```

The frontend is React 19 with TypeScript, Vite, Tailwind and React Flow. The backend
is FastAPI, with a plugin per cloud (`backend/app/csp/`). Six agents (orchestrator, IaC
generator, AWS IaC generator, documentation, security advisor, validator) are system
prompts in `backend/app/agents/prompts.py`, run on the model you configure. The
documentation agent is grounded in the Microsoft Learn MCP server
(`backend/app/mcp/learn_mcp.py`), which Liftoff calls over MCP's Streamable HTTP
transport for every provider.

## Configuration

Every setting has a safe default.

| File | Settings |
|------|----------|
| `backend/.env` ([example](backend/.env.example)) | `AI_PROVIDER`, `AI_MODEL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `AZURE_OPENAI_*`, `AZURE_AI_PROJECT_ENDPOINT`, `AWS_*`, `CORS_ORIGINS`, `ALLOWED_HOSTS`, `API_AUTH_TOKEN`, `GUARDRAILS_ENABLED`, `IAC_REFERENCE_EXISTING_NETWORKS` |
| `frontend/.env.local` ([example](frontend/.env.example)) | `VITE_API_URL`, `VITE_API_TOKEN` |
| `agents/.env` ([example](agents/.env.example)) | `AZURE_AI_PROJECT_ENDPOINT`, `AZURE_AI_MODEL_DEPLOYMENT_NAME` |

All `.env` files are ignored by git.

## Security model

The backend deploys with your Azure CLI and AWS credentials, so it is built as a
single-user tool that runs on your machine:

- it listens on `127.0.0.1` only,
- it rejects cross-site requests and unexpected `Host` headers (DNS rebinding),
- it can require a bearer token (`API_AUTH_TOKEN`),
- every value passed to `az` is validated, commands run without a shell, and
  uploaded template paths cannot leave a temporary directory,
- it stores no keys of its own: Azure access goes through `DefaultAzureCredential`, AWS
  through the standard credential chain, and AWS deployments can be limited to
  `AWS_ALLOWED_ACCOUNT_IDS`.

Read [SECURITY.md](SECURITY.md) before running it for other people, and to report a
vulnerability privately.

## FAQ

**Where does my data go?** Your diagram is sent to the AI provider you configure when
you use an AI feature. The browser downloads public schema and icon data from GitHub,
`schema.management.azure.com` and the Iconify API. For Azure questions the backend
searches Microsoft Learn through its public MCP server. There is no telemetry.

**Does it support AWS and Google Cloud?** AWS yes: diagrams, CloudFormation
generation, AWS guardrails and change-set deployment. Google Cloud not yet; clouds are
plugins (`backend/app/csp/`) and the guardrail catalog is keyed by cloud, so adding one
is a contained piece of work.

**Which models can I use?** Anything with an OpenAI-compatible chat API: OpenAI,
Azure OpenAI, local models through Ollama or LM Studio, hosted gateways such as
OpenRouter, or Azure AI Foundry agents. Pick one in `backend/.env`. The agents are
plain system prompts (`backend/app/agents/prompts.py`), so you can also tune them.

**Can I trust the generated code blindly?** No. It is compiled, checked and previewed,
which removes most of the usual failure modes, but review it like any other pull
request before it reaches production.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "AI features are not configured" or HTTP 503 | Expected until you [enable the AI features](#enabling-the-ai-features). |
| "Could not connect to Azure AI Foundry" | Run `az login`, check `AZURE_AI_PROJECT_ENDPOINT`, and confirm the Azure AI User role on the project. |
| The deploy panel says you are not authenticated | Run `az login` on the machine running the backend, then refresh the status. |
| What-If fails with `ResourceGroupNotFound` | Deployments target an existing resource group: `az group create -n <name> -l <region>`. |
| "Origin not allowed" (HTTP 403) in the browser console | Add the address you opened the UI from to `CORS_ORIGINS` in `backend/.env`. |
| "Invalid host header" (HTTP 400) | Add the hostname to `ALLOWED_HOSTS` in `backend/.env`. |
| The properties panel is empty | The schema is fetched from `raw.githubusercontent.com`; check your network or proxy. |
| Port 5173 or 8000 is already in use | Run `npm run dev -- --port 5174` and `uvicorn main:app --port 8001`, then update `VITE_API_URL` and `CORS_ORIGINS`. |

## Project layout

```
backend/    FastAPI API, guardrail engine, Foundry client, Azure CLI deployment
frontend/   React application: canvas, property editor, IaC preview, deploy flow
agents/     Scripts that create, test and delete the Azure AI Foundry agents
examples/   Diagrams you can import straight away
docs/       Design notes
scripts/    Development launchers
```

## Development

```bash
cd backend && pip install -r requirements-dev.txt && pytest && ruff check .
cd frontend && npm test && npm run lint && npm run build
```

Continuous integration runs these checks and a secret scan on every push and pull request.

## Roadmap

- Per-user Microsoft Entra sign-in instead of the shared Azure CLI identity
- Import of architecture documents and images
- Terraform plan preview next to Bicep What-If
- Cost estimates on the canvas

The schema catalog design is described in
[docs/dynamic-schema-canvas-plan.md](docs/dynamic-schema-canvas-plan.md).

## Contributing

New guardrails, dependency rules, example diagrams, fixes and documentation are all
welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to get set up and where each
kind of change lives.

## License

[MIT](LICENSE). Copyright (c) 2026 Mudassir Ahmed Mohammad.

Azure, Bicep and related marks are trademarks of Microsoft. Liftoff is an
independent project and is not affiliated with or endorsed by Microsoft.
