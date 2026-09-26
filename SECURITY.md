# Security

## Threat model

Liftoff's backend runs `az deployment` commands **with the Azure CLI identity of the
machine it runs on**. Anyone who can call its API can preview and deploy resources
into every subscription that identity can reach. It is therefore built as a
**single-user tool on your own machine**, and ships with these defences:

| Control | Where |
|---------|-------|
| Binds to `127.0.0.1` by default | `backend/app/core/config.py` (`HOST`) |
| Host-header allow-list (blocks DNS rebinding) | `TrustedHostMiddleware`, `ALLOWED_HOSTS` |
| Cross-origin state-changing requests rejected | `app/core/security.py`, `CORS_ORIGINS` |
| Optional bearer token on `/api/*` | `API_AUTH_TOKEN` (frontend: `VITE_API_TOKEN`) |
| `az` is run without a shell; every argument is validated (resource group, subscription GUID, region) | `app/api/endpoints/deploy.py` |
| Uploaded template paths confined to a temp dir (no `..`, absolute, drive or UNC paths) | `_safe_join` in `deploy.py` |
| No API keys: Azure AI Foundry is reached with `DefaultAzureCredential` | `app/agents/foundry/foundry_client.py` |
| No secrets in the repo; all `.env` files are git-ignored | `.gitignore` |

## Running it for more than one person

Don't expose the backend directly. At a minimum:

1. Put it behind an authenticating reverse proxy (for example Entra ID / Easy Auth)
   and set `API_AUTH_TOKEN`.
2. Set `ALLOWED_HOSTS` and `CORS_ORIGINS` to your real hostname only.
3. Run it under a dedicated identity with least-privilege RBAC scoped to the
   resource groups it may deploy to, not your personal account.
4. Keep in mind that `VITE_*` values are compiled into the frontend bundle, so a
   token placed there is visible to anyone who can load the app.

Templates are executed by Azure Resource Manager as written. Bicep functions such
as `loadTextContent()` read files relative to the template, which is confined to a
temporary directory, but review generated IaC before deploying it to production.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's
[private vulnerability reporting](../../security/advisories/new) for this
repository. You should get a response within 7 days. Please include steps to
reproduce and the affected version or commit.
