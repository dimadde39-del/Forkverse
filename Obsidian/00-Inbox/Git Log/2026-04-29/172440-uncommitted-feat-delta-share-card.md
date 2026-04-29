# Delta Share Card Implementation

Date: 2026-04-29
Project: [[01-Projects/MonteRun/PROJECT]]
Status: implemented before commit

## What Changed
- Added `monterun_baseline_result` and `monterun_latest_result` localStorage handling in `components/SimulatorClient.tsx`.
- Parse flow now resets baseline/latest; what-if recalculation keeps baseline and only updates latest.
- Share card view model computes delta fields in `useMemo` and writes storage in `useEffect`, matching `delta_share_card_plan.md` React ordering.
- Main simulator share card and `/share` page now render baseline-to-current runway/survival deltas.
- Share URLs and OG URLs now carry `baselineRunway` and `baselineSurvival`.
- `/api/og` renders delta images as `baseline% → current%` with a dry verdict like `Was 23%. Gained 2.9 months.`

## Verification
- `npx tsc --noEmit`
- `npm run build`
- `curl.exe` runtime checks against `/api/og` delta and non-delta variants returned `200 image/png`.
- `/share` runtime HTML check confirmed baseline params and delta markup are emitted.

## Notes
- Baseline is intentionally not overwritten by slider/what-if changes.
- Delta display is suppressed when result change is effectively zero or stored/current horizons are not comparable.
