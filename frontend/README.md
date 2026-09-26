# Liftoff frontend

React 19 + TypeScript + Vite single-page app: the visual canvas, property panels,
validation, IaC preview and deploy flow. See the [root README](../README.md) for
the full picture.

## Develop

```bash
npm install
cp .env.example .env.local   # optional - defaults to http://localhost:8000
npm run dev                  # http://localhost:5173
```

| Script | What it does |
|--------|--------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check and production build to `dist/` |
| `npm run lint` | ESLint (CI runs it with `--max-warnings 0`) |
| `npm test` | Vitest unit + contract tests |
| `npm run preview` | Serve the production build |

## Layout

```
src/
├── components/
│   ├── layout/       TopBar, ServicePalette, DiagramCanvas, RightPanel, IssuesPanel
│   ├── nodes/        ServiceNode, GroupNode
│   ├── modals/       IaC preview + deploy, guardrail report, prompt/import, explorer
│   └── properties/   Live Bicep-schema property editor
├── data/             Curated Azure service palette
├── hooks/            Schema, catalog, IaC and account hooks
├── lib/              Validation, dependency rules, guardrail helpers, API config
├── pages/            Landing and Workspace routes (lazy-loaded)
├── services/         Backend clients, Bicep/ARM schema fetchers, validators
├── store/            Zustand stores (diagram, tabs, IaC)
├── test/             Vitest tests and backend-generated contract fixtures
└── types/            Shared TypeScript types
```

## Theme

Brand colours are Tailwind tokens (`brand-primary`, `brand-accent`, ...) defined
once in `src/index.css` under `@theme`. Change them there to re-skin the app.
Azure service icons and colours are left untouched.
