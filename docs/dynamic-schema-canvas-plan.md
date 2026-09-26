# Dynamic Azure Schema-Driven Architecture Canvas: Improvement Plan

> Prepared 2026-07-26 from a multi-agent investigation (9 parallel code + research agents, then a principal-architect / SRE / DevOps synthesis) of the Liftoff app. Every claim below is grounded in the actual frontend/backend source and current Azure schema sources. File paths are relative to `frontend/` or `backend/` unless noted.

## A. Executive Summary

- **Current state:** The palette is a static, build-time JSON file (`src/data/azureServices.json`, 85 services, `"lastUpdated": "2025-01-07"`), and prompt-generated nodes resolve icons through a separate ~23-entry hardcoded map (`AppShell.getIconForResourceType`). The per-service config panel *is* already dynamic (fetches real Bicep types from `Azure/bicep-types-az`), but it is bolted onto a static palette and a hardcoded dependency table. Two parallel catalog systems exist and disagree.
- **Target state:** A single source of truth: a pre-indexed Azure schema catalog derived from `Azure/bicep-types-az`, served by a new backend **schema service**, driving (1) the palette, (2) per-service required/optional fields, and (3) a dependency/hierarchy validation graph. Nothing about *which fields a service needs* is authored by hand or produced by an LLM.
- **Requirement 1 (proper services, latest palette, dynamic):** Blocked today because the palette reads bundled JSON. Fix by generating the palette from the schema index + live `az provider show` availability filtering.
- **Requirement 2 (every required field per service, from Azure):** Half-solved. `bicepSchemaFetcher.ts` already reads `flags & 1` (Required) from real schema. The gap is that it is not gated (required-but-empty is only colored orange, never blocking) and the palette that feeds it is static.
- **Requirement 3 (hierarchy + cross-resource deps, cannot lock a bad config):** Blocked. Dependencies are a hardcoded table (`src/lib/serviceDependencies.ts`) surfaced as advisory "Issues" only. There is no requirement-slot model, no topological gate, no `sameRegionRequired` check.
- **Single biggest architectural gap:** There is **no deterministic schema/dependency service**. IaC and diagram generation are 100% LLM prompt-driven (`agents.py` `DIAGRAM_JSON_SCHEMA` + `iac-generator-agent`), with the *first and only real Azure schema check occurring at `az deployment group what-if` at deploy time* (`deploy.py`). Config-field correctness is currently hallucinable. It must become schema-derived and enforced before "lock config."
- **Reusable asset:** The dynamic Bicep-schema fetch path (`bicepSchemaFetcher.ts` + `useBicepSchema.ts`) and the unused `serviceCatalog.ts`/`azureSchemaService.ts`/`azureIconService.ts` triplet already prove the runtime-fetch pattern. The plan consolidates rather than rebuilds.

---

## B. Current-State Assessment: Hardcoded vs Dynamic

### B.1 Palette (blocks Requirement 1)
- **`src/data/azureServices.json`** - 85 services / 17 categories, imported at build time by `src/components/layout/ServicePalette.tsx:9,38`. No `fetch`, no runtime refresh. This is the palette's sole source of truth. New Azure services and new required properties never appear until someone hand-edits this file.
- **`src/data/groupTemplates.ts`** - hardcoded container/visual templates.
- **`src/lib/azureIcons.ts`** (`azureIconMap`, ~110 entries) + **`AppShell.getIconForResourceType`** (~23 entries) + **`src/services/azureIconService.ts`** (`RESOURCE_TYPE_ICON_MAP`) - **three** independent, drifting icon maps. AppShell emits tokens (`azure:kubernetes`, `azure:resource`) that `azureIconMap` does not define, so prompt-imported nodes silently fall to `mdi:cube-outline`.
- **A working dynamic catalog already exists but is unused by the palette:** `src/services/serviceCatalog.ts` (`fetchServiceCatalog()` pulls the live Bicep types index, filters to a hardcoded `PRIORITY_SERVICES` list, caches 24h in `localStorage`). Its only consumers are the properties panel/validation, never `ServicePalette.tsx`.

### B.2 Per-service config fields (partially solves Requirement 2)
- **Dynamic (good):** `src/components/properties/DynamicBicepPropertiesSection.tsx` -> `useBicepSchema(resourceType)` -> `src/services/bicepSchemaFetcher.ts` fetches `https://raw.githubusercontent.com/Azure/bicep-types-az/main/generated`, picks the latest API version, walks `$ref`, and reads `isRequired = flags & 1`, `isReadonly = flags & 2` (`bicepSchemaFetcher.ts:294-296`). The *set of fields per service is already schema-derived.* 24h in-memory cache (`BicepCache`).
- **Hardcoded assist layer (risk):** despite the "FULLY DYNAMIC" banner, `DynamicBicepPropertiesSection.tsx` carries `FALLBACK_OPTIONS` (~30 dropdown lists, `:18-193`), `PROPERTY_HINTS` (`:196-206`), a `formatEnumLabel` label map (`:331-357`), and regex enum heuristics (`:293-323`). `azureLocations` is duplicated hardcoded in `RightPanel.tsx:88-102` and dead `PropertiesPanel.tsx:12-26`. Basic Information (name/location) is fully hardcoded (`RightPanel.tsx:193-244`).
- **No hard gate (blocks Requirement 2's "nothing that blocks deployment is missed"):** required fields are only colored orange-when-empty / green-when-filled (`DynamicBicepPropertiesSection.tsx:400-427`). The panel never blocks editing, save, or IaC export on a missing required field. `isFilled` drives color only.
- **Dead code:** `src/components/layout/PropertiesPanel.tsx` + `useAzureSchema.ts` are never imported.

### B.3 Dependencies / hierarchy (blocks Requirement 3)
- **Hardcoded rules table:** `src/lib/serviceDependencies.ts` (per-`serviceId` required/recommended/optional deps + container requirements) consumed by `src/lib/validationEngine.ts`. Surfaced as advisory issues in the "Issues" tab (`RightPanel.tsx:18`), **not blocking**.
- **Edge auto-fill is hardcoded pattern-matching:** `diagramStore.onConnect` -> `getDynamicEdgeInheritanceSync` (`dynamicSchemaInheritance.ts:488-551`): App Service Plan->`serverFarmId`, Log Analytics->`WorkspaceResourceId`, SQL->`serverName`, etc. Attempts schema first, falls to hardcoded patterns.
- **The only real structural gate** is `diagramStore.validateDiagramForExport` (`:1139-1200`, services must be direct children of a `resourceGroup`), and it is not wired into the panel or a "lock" action.
- **No requirement-slot model, no topological/cycle gate, no region co-location check, no name-availability check.**

### B.4 Backend (no deterministic schema authority)
- **Diagram generation is LLM-only:** `POST /diagram/generate` (`agents.py:408-477`) prepends a static `DIAGRAM_JSON_SCHEMA` prompt and calls `iac-generator-agent` (there is no dedicated diagram agent). Output is `json.loads`'d after stripping fences.
- **IaC generation is LLM-only prompt engineering** (`foundry_client.py:244-251,393-425` hand-written "BICEP SYNTAX RULES"). "Validation" is keyword sniffing (`iac.py`: `has_errors = any(word in content for word in ['error','invalid','fail'])`). `IaCResponse.mcp_enhanced=True` is hardcoded and misleading - no schema validation occurs.
- **MCP is barely wired:** `MCP_BICEP_URL` (`config.py:19`) points at a non-functional `.../tools/azure-bicep-schema` path and is **never called**. `integration_settings.py` (`get_mcp_servers()`) is dead and references undefined `Settings` fields. The only real MCP is the Foundry-hosted `azure-docs-agent` with Microsoft Learn MCP (`agents/create_agents.py`). No bicep-schema MCP is attached to any agent.
- **First real Azure schema enforcement = deploy time:** `az deployment group what-if/create` in `deploy.py` (shells `az` with `shell=True`, RG scope only).

---

## C. Target Architecture

### C.1 Schema source of truth
- **Primary: `Azure/bicep-types-az`** (`generated/index.json` -> per-provider `types.json`). Justification (from research): cleanest normalized machine-readable model, resolves the OpenAPI `$ref`/`allOf` graph into flat typed objects with explicit `flags` (Required=1, ReadOnly=2), enums as `UnionType` over `StringLiteralType`, `modifiers` (minLength/maxLength/pattern/minValue/maxValue), hierarchy encoded in the type name (`storageAccounts/blobServices/containers`), MIT-licensed. This is *the same data* the frontend already fetches in `bicepSchemaFetcher.ts` and the same data the Azure MCP `bicepschema_get` tool serves. Consolidate on it.
- **Fallback 1: `Azure/azure-resource-manager-schemas`** (hosted `schema.management.azure.com`) - plain JSON Schema, drop-in for any resource missing from Bicep types.
- **Fallback 2 / tie-breaker: `Azure/azure-rest-api-specs`** OpenAPI - newest preview APIs.
- **Live availability overlay: `az provider show`** (per subscription/region resourceTypes + apiVersions) and `checkNameAvailability` per RP - the only source of *what the caller can actually deploy* and *whether a global name is free*.
- **Two known gaps to handle ourselves:** (a) **defaults** live only in prose `description` (no machine field) - do not auto-populate defaults from schema; (b) **child-resource enumeration** is not provided by MCP tools - derive it from the pre-built index by splitting type names.

### C.2 Build-time index + runtime availability (hybrid caching)
Research is decisive here: per-service **runtime MCP calls are 1-3s each and payloads are 15-30KB** - fine for interactive single-resource authoring, poor for bulk palette/form generation and subject to throttling (429). Therefore:

- **Build-time (pre-indexed):** a sparse-clone / pinned-commit ingestion of `bicep-types-az` into our own normalized store, keyed by `resourceType@apiVersion`, containing: display metadata, category, icon ref, required/optional/readonly field lists, enums, constraints, nesting (parent type), scope, name-uniqueness tier, naming regex, and detected `resourceId` reference properties. This is the palette + form backbone. Deterministic, reviewable, version-pinned, zero tail latency.
- **Runtime overlay (cached, short TTL):** `az provider show`/ARM Providers REST to filter the catalog to the subscription+region and pick default/latest API version; `checkNameAvailability` on commit; VM/SKU availability lazily per `(type, region)`.
- **Runtime fallback (on-demand, cache-per-type):** Azure MCP `bicepschema_get` or Learn `azure-bicep-schema` for any resource missing from the pre-built index (prototyping / brand-new types).
- **Caching strategy:** index served from backend with `ETag` + long `max-age`; availability overlay TTL ~monthly for region matrix, per-session for provider list, no-cache for `checkNameAvailability`; frontend keeps the existing `localStorage` 24h pattern (`serviceCatalog.ts`) but pointed at the new endpoint.

### C.3 New backend "schema service" API
Add `backend/app/api/endpoints/schema.py` (router `/api/schema`), backed by a new `backend/app/services/schema_index/` package (ingestion + normalized store + parser reused from the same index-ref format the frontend parses):

| Endpoint | Purpose | Response shape (essentials) |
|---|---|---|
| `GET /api/schema/catalog?subscription=&region=` | Palette source; catalog filtered by live availability | `{ services: [{ resourceType, apiVersion, displayName, category, iconRef, scope, nameUniqueness }], categories: [...], indexVersion }` |
| `GET /api/schema/resource/{provider}/{type}?apiVersion=` | Full per-service schema for the form | `{ resourceType, apiVersion, fields:[{path,type,required,readonly,secure,enum,min,max,pattern,description}], nested, childTypes:[...] }` |
| `GET /api/schema/dependencies/{provider}/{type}` | Requirement slots + reference edges | `{ requirementSlots:[{property,allowedTargetTypes,required,cardinality,sameRegionRequired}], parentType, scope }` |
| `POST /api/schema/validate-graph` | Server-side authoritative validation of the whole canvas graph before lock/deploy | `{ nodes:[{id,status,missingSlots,placementErrors}], cycleDetected, topoOrder }` |
| `GET /api/schema/availability?type=&region=` | SKU/name/region availability (proxies `az`/ARM) | `{ regionOk, skus:[...], nameRule }` |
| `POST /api/schema/name-availability` | `checkNameAvailability` per RP on commit | `{ available, reason }` |
| `GET /api/schema/version` | Index provenance (pinned commit, API-version coverage) | `{ bicepTypesCommit, generatedAt }` |

This replaces the misleading `mcp_enhanced=True` flag and the dead `integration_settings.py`/`deps.py` MCP stubs with a real schema authority. The seams called out in the dossier (`iac.py` `_get_warnings`/`_extract_resources`, `foundry_client.generate_iac_modular` prompt) then consume this service for *real* pre-deploy validation instead of regex/keyword heuristics.

### C.4 Frontend dynamic-form stack
- **Adopt RJSF v6 + `@rjsf/fluentui` + `@rjsf/validator-ajv8` (AJV 8 + `ajv-formats`)** for the per-service panel. Rationale: our source (`bicep-types-az`) is already JSON-Schema-shaped; RJSF gives arrays, nested objects, `oneOf` selectors, and error plumbing for free; the Fluent theme matches the Azure Portal.
- **Add a pure mapping layer** `mapArmSchema(resourceSchema): { jsonSchema, uiSchema }` (frontend `src/services/schemaForm/mapArmSchema.ts` or backend-emitted). Emits: `enum`->dropdown, `secureString`->`ui:widget:"secret"`, min/max/pattern->AJV, `if/then/else` for conditional visibility (SKU-gated fields), `oneOf` for plaintext-or-Key-Vault secrets, nested objects->collapsible `ObjectFieldTemplate`, arrays->card `ArrayFieldTemplate`, tags->`additionalProperties`. Cross-field rules via `customValidate`.
- **This replaces** `DynamicBicepPropertiesSection.tsx`'s hardcoded `FALLBACK_OPTIONS`/`PROPERTY_HINTS`/regex-enum layer. Keep RJSF fed by the *same* mapping output so a future custom TanStack renderer is a drop-in if RJSF templating becomes a bottleneck.
- **Escape hatch:** TanStack Form v1 + custom recursive renderer (same mapping output) only if bespoke blade UX outgrows RJSF.

### C.5 Dependency / hierarchy model (the validation graph)
Implement the three-edge-kind model from the research as a shared TS + Python module:
- **CONTAINS** (parent/child) - derived syntactically from type-name segments (`Microsoft.Sql/servers/databases` -> parent `Microsoft.Sql/servers`). Always required; imposes nesting + scope inheritance.
- **REFERENCES** - from schema `resourceId`-typed properties (name ends `Id`/`ResourceId`, nested `.id` under a resource-named object) + a **curated override catalog** for high-value cases (`serverFarmId`->serverfarms, `subnet.id`->subnets, `WorkspaceResourceId`->workspaces). `required` from schema `required[]`. Imposes ordering only.
- **EXTENDS** - `scope`-attached extension resources (locks, roleAssignments, diagnosticSettings).
- **RequirementSlots** rendered as mandatory ports: a node is `valid` only when every required slot `filledBy != null`, endpoints match `allowedTargetTypes`, placement predicates pass (scope match, region availability, `sameRegionRequired`, naming regex + uniqueness tier, SKU availability), and a **topological sort of the combined DAG succeeds (no cycles)**. That topo order is the deployment order and the `dependsOn` source.
- **The "lock config" / "generate IaC" button is gated on this graph passing** - this is the concrete fix for Requirement 3 ("must not let the user lock a config that cannot deploy").

### C.6 Data flow (target)
```
Build:  bicep-types-az (pinned commit) --ingest--> normalized schema index (backend store)
                                                          |
Runtime palette:  Frontend --GET /api/schema/catalog--> backend --overlay: az provider show--> filtered palette
Select service:   Frontend --GET /api/schema/resource/{type}--> mapArmSchema --> RJSF Fluent form
Wire edge:        onConnect --GET /api/schema/dependencies--> fill RequirementSlot --> validation graph
Edit/commit:      validation graph (client) + POST /api/schema/validate-graph (authoritative)
                     -> topo sort OK & all slots filled & names available  ==> "Lock/Generate" enabled
Generate IaC:     graph --> deterministic dependsOn + LLM iac-generator (enrichment) --> az what-if (final check)
Prompt path:      NL prompt --> orchestrator/iac agent picks SERVICE TYPES only --> nodes snap to schema catalog
```

### C.7 New/changed frontend components
- New: `src/services/schemaService.ts` (calls `/api/schema/*`), `src/services/schemaForm/mapArmSchema.ts`, `src/components/properties/SchemaForm.tsx` (RJSF wrapper + Fluent widgets: `SecretWidget`, `RegionPicker`, `ResourceRefPicker`), `src/lib/validationGraph.ts` (CONTAINS/REFERENCES/EXTENDS + topo/cycle), `src/components/nodes/RequirementPort.tsx`.
- Replace: `ServicePalette.tsx` data source (JSON import -> `schemaService.getCatalog()`); `DynamicBicepPropertiesSection.tsx` (-> `SchemaForm`); the three icon maps -> one `iconRef` from catalog.
- Delete after migration: `src/data/azureServices.json`, dead `PropertiesPanel.tsx`/`useAzureSchema.ts`, hardcoded `serviceDependencies.ts` (rules move to schema-derived + curated catalog).

---

## D. Where the Foundry Agents Fit

**Hard principle: config-field correctness is deterministic (from schema), never LLM-authored.** The dossier shows today's config knowledge is either hardcoded or implicitly trusted from an LLM (`DIAGRAM_JSON_SCHEMA` prompt tells the model to "use correct Azure resource types"). That is exactly the class of error (wrong API version, missing required property, invented enum) that a schema index eliminates.

| Concern | Deterministic (schema service, no LLM) | LLM agent adds value |
|---|---|---|
| Which fields a service requires/optional/readonly | yes: `bicep-types-az` flags | no |
| Enum values, min/max, regex, secure flags | yes: schema `modifiers`/`UnionType` | no |
| Parent/child nesting, scope | yes: type-name derivation | no |
| Required cross-resource references + `dependsOn` order | yes: schema `resourceId` props + curated catalog + topo sort | no |
| API version selection | yes: index latest + `az provider show` availability | no |
| **Prompt -> which services to place** (NL intent -> set of resourceTypes) | - | yes: `orchestrator`/`iac-generator-agent`, good fit for fuzzy intent mapping |
| Best-practice enrichment (suggest App Insights + Log Analytics pairing, sensible SKU) | seed defaults from schema/heuristics | yes: agents propose, user confirms; values still validated against schema |
| Security/compliance review (ASB, public access, TLS) | schema flags secure fields | yes: `security-advisor-agent` (+ optional Bing grounding) |
| Docs Q&A / "how do I..." | - | yes: `azure-docs-agent` (Microsoft Learn MCP) |
| Final IaC synthesis | provide validated graph + `dependsOn` skeleton | yes: `iac-generator-agent` fills bodies; then `az what-if` is the final gate |

**Concrete change to the prompt path:** `POST /diagram/generate` should return **only service *selection* + relationships** (which `Microsoft.*` types and how they connect), then the frontend **snaps each returned node to the schema catalog** (correct apiVersion, iconRef, required slots) rather than trusting the LLM's `resourceType`/property strings. This keeps the LLM where it is strong (intent -> components) and removes it from where it is dangerous (field-level correctness). Also attach a real bicep-schema tool to `iac-generator-agent` via `build_tools()` (`agents/create_agents.py:573`), replacing the hand-maintained "BICEP SYNTAX RULES" prompt with schema grounding.

---

## E. Phased Implementation Roadmap

### Phase 0 - Consolidate & de-risk (S)
- Unify the three icon maps into one catalog-driven `iconRef`; delete dead `PropertiesPanel.tsx`, `useAzureSchema.ts`. Files: `azureIcons.ts`, `AppShell.getIconForResourceType`, `azureIconService.ts`.
- Wire `diagramStore.validateDiagramForExport` into a visible non-blocking banner (immediate safety, no new infra).
- **Value:** removes drift and dead code; no behavior risk. **Effort: S.**

### Phase 1 - Backend schema service + index (M/L) [highest leverage]
- New `backend/app/services/schema_index/` (ingest pinned `bicep-types-az` commit, normalized store, parser). New `backend/app/api/endpoints/schema.py` with `GET /api/schema/catalog`, `/resource/{type}`, `/version`.
- Reuse the frontend's proven index-walk logic (`bicepSchemaFetcher.ts`) as the parser reference.
- Replace dead `integration_settings.py`/`deps.py` MCP stubs; fix/remove `MCP_BICEP_URL`.
- **Value:** the deterministic authority everything else depends on. **Effort: L.**

### Phase 2 - Dynamic palette from catalog (M) [proves Requirement 1]
- Repoint `ServicePalette.tsx` from `azureServices.json` -> `schemaService.getCatalog()` (reuse `serviceCatalog.ts` cache pattern). Availability overlay via `az provider show`.
- Snap prompt/import nodes to the catalog in `handleImportDiagram` (`AppShell.tsx:253-497`).
- Delete `azureServices.json`. **Effort: M.**

### Phase 3 - RJSF schema-driven config panel (M) [proves Requirement 2 + adds the gate]
- Add RJSF v6 + Fluent + AJV; new `mapArmSchema.ts` + `SchemaForm.tsx`; replace `DynamicBicepPropertiesSection.tsx` and its `FALLBACK_OPTIONS`/hints.
- **Introduce the hard gate:** required-but-empty blocks "lock/generate" (not just orange). Secret widget + Key Vault `oneOf`.
- **Effort: M.**

### Phase 4 - Dependency validation graph + requirement ports (L) [proves Requirement 3]
- New `validationGraph.ts` (CONTAINS/REFERENCES/EXTENDS, RequirementSlots, topo/cycle) + `RequirementPort.tsx`; backend `POST /api/schema/validate-graph` + `dependencies` + `name-availability`.
- Replace hardcoded `serviceDependencies.ts`/`validationEngine.ts`; make `onConnect` fill slots from schema instead of `dynamicSchemaInheritance.ts` patterns.
- Gate "lock config" on graph valid + topo OK; emit deterministic `dependsOn`.
- **Effort: L.**

### Phase 5 - Agent realignment + preflight hardening (M)
- `POST /diagram/generate` returns selection-only; frontend snaps to catalog. Attach bicep-schema tool to `iac-generator-agent` (`create_agents.py:build_tools`). Feed validated graph + `dependsOn` skeleton into IaC generation; keep `az what-if` as final gate. Harden `deploy.py` `shell=True` arg interpolation.
- **Effort: M.**

Order rationale: Phase 1 unblocks everything; Phases 2/3 each deliver a visible requirement independently and low-risk; Phase 4 is the hardest and depends on 1-3; Phase 5 is polish + safety.

---

## F. Reliability / SRE + DevOps

- **Schema freshness & versioning:** pin the `bicep-types-az` commit in the index build; expose `GET /api/schema/version` (`bicepTypesCommit`, `generatedAt`). Scheduled monthly ingestion job (Azure ships API versions constantly) with a diff report; never auto-deploy a new index without a contract-test pass. Region-availability matrix refreshed monthly, SKU lists weekly/on-select.
- **Caching/invalidation:** index served with `ETag`/long `max-age`; frontend 24h `localStorage` (existing `serviceCatalog.ts` pattern) keyed on `indexVersion` so a new index busts the client cache. `checkNameAvailability` never cached.
- **Rate limits:** never call MCP/`bicepschema_get` for bulk palette/form load (1-3s, throttle-prone). Pre-built index is the default path; MCP is on-demand fallback only, cache-per-type.
- **Offline/degraded behavior:** if `az provider show` overlay fails, serve the unfiltered pre-built catalog (degraded but functional) with a "region availability unavailable" warning. If the index endpoint is down, frontend falls back to last-good `localStorage` catalog. `checkNameAvailability` failure -> warn, don't hard-block (name check is best-effort).
- **Testing strategy - contract tests against real Azure schemas:** golden tests that assert, e.g., `Microsoft.Storage/storageAccounts` requires `kind`, `location`, `name` (3-24, `^[a-z0-9]+$`), `sku`; `sku.name` enum includes `Standard_LRS`; `minimumTlsVersion` enum = `TLS1_0..TLS1_3`. Run against the pinned index in CI, plus a nightly job comparing pinned index vs `main` to flag breaking upstream changes. Snapshot `mapArmSchema` output per resource type.
- **Secrets handling:** `secureString`/`@secure()` never emitted into `default`/`enum`; masked widget with `autoComplete="new-password"`; stripped from cached/serialized form state and telemetry (`omitExtraData`); masked placeholder on reload ("leave blank to keep"); Key Vault reference `oneOf` shape preferred. Backend keeps keyless `DefaultAzureCredential`; deploy still relies on caller `az login` (`deploy.py check_az_auth`).
- **Deployment preflight:** keep `az deployment group what-if` as the final authoritative gate (`deploy.py`), but now it should rarely surface schema errors because the graph validated first. Harden `deploy.py`: it interpolates user-supplied `resource_group`/`subscription_id` into `az` args with `shell=True` - validate/allow-list these before the shell call.
- **Observability:** structured logs + metrics on schema-service cache hit rate, index age, `az provider show` overlay latency/failures, `validate-graph` pass/fail reasons (which slot/predicate failed), name-availability call volume. Replace the misleading hardcoded `mcp_enhanced=True` (`iac.py:55`) with a real `schema_validated` flag reflecting whether the graph passed.

---

## G. Risks, Unknowns, Tradeoffs

- **Runtime MCP vs pre-built index:** chose pre-built index (latency/throttle/child-enumeration/version-pinning wins) at the cost of owning ingestion + refresh. Risk: index staleness between refreshes; mitigated by `az provider show` overlay for availability and MCP on-demand fallback for missing types.
- **RJSF vs custom forms:** chose RJSF v6 for batteries-included + Fluent theme + JSON-Schema-native source. Risk: deep nested arrays in a narrow right panel need `ObjectFieldTemplate`/`ArrayFieldTemplate` overrides; RJSF bundle size. Mitigation/escape hatch: same `mapArmSchema` output can feed a TanStack custom renderer later.
- **Completeness vs UX overload:** rendering *every* required + important-optional field per Requirement 2 risks overwhelming panels (Storage Account has dozens of nested props). Mitigate with Basics/Advanced disclosure driven by `flags` + a curated "important optional" allow-list per top service, but never hide a `Required` non-`ReadOnly` field.
- **Defaults gap:** `bicep-types-az` has no machine-readable defaults (prose only). We will not auto-fill defaults from schema; seed a small curated defaults table for top services and let agents suggest the rest (schema-validated).
- **Dependency-catalog imperfection:** `resourceId` properties are plain strings; naming/`x-ms-arm-id-details` signals are inconsistent. Automated reference detection needs a curated override catalog (the high-value ~15 references) - ongoing maintenance, but far smaller than today's full hardcoded `serviceDependencies.ts`.
- **Agent contract change risk:** switching `POST /diagram/generate` to selection-only changes the LLM contract and the frontend snap logic; regression risk on prompt path. Phase it behind a flag; keep the old importer until snap-to-catalog is proven.
- **Child-resource UX unknown:** MCP won't enumerate children; the index will, but modeling storage-account-plus-containers as separate nodes vs nested config is a UX decision to validate with users.
- **Model-switch operational trap (already documented):** editing `backend/.env` `AZURE_OPENAI_MODEL` does nothing; models are baked at agent creation (`create_agents.py:639` `PromptAgentDefinition(model=MODEL_DEPLOYMENT)`). Any agent change requires re-running `agents/create_agents.py`. Document this in the runbook so Phase 5 changes are deployed correctly.

---

## H. First PR - Definition of Done

**Recommended service: `Microsoft.Storage/storageAccounts`.** It is the canonical example the user cited, it has rich required fields + closed/open enums + regex naming (3-24, `^[a-z0-9]+$`) + global name uniqueness + child types (`blobServices/containers`), and it is already validated in the schema research, so it exercises every part of the pipeline.

**Smallest vertical slice (one service, palette -> schema -> form -> validation -> IaC):**
1. **Backend:** add `backend/app/api/endpoints/schema.py` with `GET /api/schema/resource/Microsoft.Storage/storageAccounts` returning normalized fields (required/optional/readonly, enums, `modifiers`) parsed from a pinned `bicep-types-az` `types.json` (can start with an on-request fetch + cache; full ingestion job deferred). Include `nameRule` and `nameUniqueness: "global"`.
2. **Palette:** in `ServicePalette.tsx`, source the single Storage Account entry from the catalog endpoint instead of `azureServices.json` (feature-flagged; rest of palette unchanged).
3. **Form:** add RJSF v6 + `@rjsf/fluentui` + AJV; new `mapArmSchema.ts` + `SchemaForm.tsx`; render the Storage Account panel from the fetched schema, replacing `DynamicBicepPropertiesSection` for this one resourceType. Enum dropdowns (`sku.name`, `minimumTlsVersion`), regex validation on `name`, `secureString` masking if present.
4. **Validation gate:** required-but-empty (`kind`, `location`, `name`, `sku`) + name-regex failure **block** a new "Lock config" action on the node (first real gate); wire `POST /api/schema/name-availability` for a live global-name check on commit.
5. **IaC:** confirm the locked, schema-valid Storage Account node flows through existing `serializeDiagram` -> `POST /api/agents/iac/generate` and passes `az deployment group what-if` (`deploy.py`) with zero schema errors.

**DoD acceptance:**
- Dragging Storage Account shows fields fetched live from Azure schema (verified: `sku.name` dropdown matches `Standard_LRS..Premium_LRS`, `minimumTlsVersion` = `TLS1_0..TLS1_3`, `name` enforces 3-24 lowercase-alnum).
- Leaving `sku` or `name` empty, or an invalid name, **disables Lock config** with an inline error.
- A contract test in CI asserts the required-field set + `name` regex + `sku.name` enum for Storage Account against the pinned index.
- Generated Bicep for a valid Storage Account passes `az what-if` on a test RG.
- No new hardcoded field/enum lists introduced for Storage Account (all from `/api/schema/resource`).

This slice proves the deterministic pipeline end-to-end for one service and establishes every seam (schema endpoint, mapping layer, RJSF panel, blocking validation, IaC + what-if) that Phases 2-5 generalize across the catalog.
