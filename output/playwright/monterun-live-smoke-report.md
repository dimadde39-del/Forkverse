# MonteRun Live Smoke Report

Target: `https://forkverse-8inw.vercel.app/` by default, or `MONTERUN_URL` when set.
Updated: 2026-05-01

## Scenario

Input:

```text
cash $8,000,000, monthly burn $950,000, monthly income $700,000, income starts in 3 months, horizon 18 months.
```

## Automated Flow

The reusable Playwright spec is:

```text
output/playwright/monterun-live-smoke.spec.ts
```

Core path covered:

1. Open the target app.
2. Fill the English `Example: cash...` scenario composer.
3. Click `Run simulation`.
4. Wait for `/api/parse` with a launch-hardening timeout.
5. Verify `SIMULATED`, `PLAN CAPTURED`, simulation completion, `1000 sims`, and share CTA.
6. Apply stress assumptions and verify `Burn multiplier precise value`.
7. Apply the burn-reduction lever by its math effect and verify `Monthly Burn precise value`.
8. Open the share page and verify the OG image loads at `1200x630`.
9. Fail on browser console errors or warnings, so Recharts/layout regressions stay visible.

## Timeout Expectations

The parser is expected to be around `9.5s`, with live-network buffer. The smoke test now fails `/api/parse` after `60s` and caps the full test at `105s`, replacing the previous `134s`/`240s`-style waits.

## Commands

Live default:

```powershell
npm run test:live:monterun
```

Local Vercel dev or alternate deployment:

```powershell
npx vercel dev --listen 127.0.0.1:3001 --yes
$env:MONTERUN_URL = 'http://127.0.0.1:3001/'
npm run test:live:monterun
```

Plain `next dev` serves the UI but not the Python `/api/parse` function, so use a target that includes Vercel functions.

The test does not fake passing when the live environment is unavailable; target failures surface as normal Playwright failures.

## Latest Verification

2026-05-01:

- `npm run test:live:monterun` against the live default passed: `1 passed (16.8s)`.
- Earlier hardening runs exposed and fixed stale assertions for run count, route numbering, rendered status text, and OG image load timing.
