# MonteRun Live Smoke Report

Target: `https://monterun.vercel.app/` by default, or `MONTERUN_URL` when set.
Updated: 2026-05-10

## Scenario

Input:

```text
cash $20,000, monthly burn $8,000, monthly income $2,000, income starts immediately, horizon 18 months.
```

## Automated Flow

The reusable Playwright spec is:

```text
output/playwright/monterun-live-smoke.spec.ts
```

Core path covered:

1. Open the target app.
2. Fill the `Describe your financial scenario` scenario composer.
3. Click `Run simulation`.
4. Wait for `/api/parse` with a launch-hardening timeout.
5. Verify `SIMULATED`, `PLAN CAPTURED`, simulation completion, `1000 sims`, baseline localStorage, and no initial delta card.
6. Lower `Monthly Burn precise value` to create a positive runway delta.
7. Verify the Delta Share Card and exact X web-intent tweet text.
8. Verify the baseline months key was not overwritten by the what-if result.
9. Fail on browser console errors or warnings, so Recharts/layout regressions stay visible.

## Timeout Expectations

The parser is expected to be around `9.5s`, with live-network buffer. The smoke test fails `/api/parse` after `60s` and caps the full test at `90s`.

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

2026-05-10:

- Updated the smoke spec for the lightweight Delta Share Card: baseline months localStorage, positive what-if delta, X web-intent copy, and no baseline overwrite.
- `vercel dev --local --listen 127.0.0.1:3001 --yes` completed `next build`, then failed in the local Vercel runtime with `The first argument must be of type string ... Received undefined`; full smoke still needs a working Vercel/local-functions target.
- `next dev -H 127.0.0.1 -p 3000` rendered the main page cleanly; a Playwright sanity check found the heading visible, no initial Delta Share Card, and no browser console/page errors.

2026-05-08:

- `npm run test:live:monterun` against the renamed default target failed before app load because `https://monterun.vercel.app/` returned Vercel `DEPLOYMENT_NOT_FOUND`.
- Local `vercel dev --local --listen 127.0.0.1:3001 --yes` also failed during adapter boot with a Vercel CLI runtime error, so the full live smoke needs a reachable `MONTERUN_URL`.

2026-05-01:

- `npm run test:live:monterun` against the live default passed: `1 passed (16.8s)`.
- Earlier hardening runs exposed and fixed stale assertions for run count, route numbering, rendered status text, and OG image load timing.
