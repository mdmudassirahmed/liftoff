# Contributing to Liftoff

Thanks for helping! Bug reports, new guardrails, service rules, docs and features
are all welcome.

## Getting set up

Follow the [Quick start](README.md#quick-start). You don't need an Azure AI Foundry
project to work on the canvas, validation, guardrails or deploy flow, and the tests
never call Azure.

## Before you open a pull request

```bash
# backend
cd backend
pip install -r requirements-dev.txt
pytest
ruff check .

# frontend
cd frontend
npm test
npm run lint -- --max-warnings 0
npm run build
```

CI runs the same commands.

## Good first contributions

- **Add a guardrail.** Add a tuple to `CONTROLS` in
  `backend/scripts/build_guardrail_catalog.py`, run the script, and commit the
  regenerated JSON. Map it to a Microsoft Cloud Security Benchmark control and,
  where one exists, the built-in Azure Policy that audits it.
- **Add an enforceable check.** Add an entry to `_ENFORCED_PROPERTIES` and `_CHECKS`
  in `backend/app/services/guardrails.py`, with a test in `tests/test_guardrails.py`.
- **Add a dependency rule.** Extend `frontend/src/lib/serviceDependencies.ts`
  (for example "X requires Y") and cover it in `src/test/validationEngine.test.ts`.
- **Add a service to the palette.** Edit `frontend/src/data/azureServices.json`.

## Guidelines

- Keep pull requests focused; one change per PR is easiest to review.
- Match the style of the surrounding code.
- Never commit secrets, subscription IDs, tenant IDs or real resource names.
- If the backend response shape changes, regenerate the frontend contract fixtures
  in `frontend/src/test/fixtures/` (see `backend/tests/test_guardrails.py`).

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE)
and that you'll follow the [Code of Conduct](CODE_OF_CONDUCT.md).
