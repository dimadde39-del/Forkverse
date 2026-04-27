# Capital Shock Burn Multiplier - 2026-04-27

## Verdict
PASS. Board Mode now supports two new deterministic stress vectors: `capital_shock` and `burn_multiplier`. Defaults preserve old scenarios: `capital_shock=0.0`, `burn_multiplier=1.0`.

## Scope
- Numpy core: `engine/monte_carlo.py`
- Parser and API plumbing: `api/parse.py`, `api/simulate.py`, `api/tg_webhook.py`
- UI controls and Board Mode stress application: `components/SimulatorClient.tsx`, `components/WhatIfControls.tsx`

## Math Invariants
- `capital_shock` is subtracted from starting capital before month 1 cashflow.
- Over-shock (`capital_shock >= initial_capital`) depletes immediately and keeps paths at zero.
- `burn_multiplier` multiplies fixed and flexible monthly expenses.
- No loops over simulation paths were added; hot path remains NumPy vectorized with `np.multiply`, `np.cumsum`, `np.maximum.accumulate`, and `np.where`.
- Old calls without the new fields are bit-for-bit equal to explicit defaults.

## Parser Routing
`suggested_stress.target` is now restricted to:
- `income_delay`
- `capital_shock`
- `burn_multiplier`

DeepSeek v4-flash prompt routing:
- delayed revenue -> `income_delay`
- one-time surprise bill or cash hit -> `capital_shock`
- recurring expense inflation or underestimated burn -> `burn_multiplier`

Parser stress validation keeps `burn_multiplier` suggestions at `>= 1.0`, so a stress button cannot secretly improve the plan.

## UI Validation
- What-If controls include Capital Shock and Burn Multiplier sliders.
- Board Mode `Apply stress` handles all three target types.
- `Keep assumption` can restore applied stress fields back to baseline.
- UI-facing scan found no active `ForkVerse` branding in app/components/share-card surface.

## Commands
- `python -B -m py_compile engine\monte_carlo.py api\parse.py api\simulate.py api\tg_webhook.py` -> PASS
- Python invariant smoke for defaults, shock, multiplier, over-shock, invalid values, percentiles, parser target filtering -> PASS
- `npm exec tsc -- --noEmit --incremental false` -> PASS
- `npm run build` -> PASS
- `git diff --check -- api\parse.py api\simulate.py api\tg_webhook.py engine\monte_carlo.py components\SimulatorClient.tsx components\WhatIfControls.tsx` -> PASS

## Known Non-Blocking Issue
`npm run lint` is not a reliable gate in this repo right now. Next 16 treats the existing `next lint` script as an invalid project directory (`C:\ForkVerse\lint`). This predates the stress-vector changes and should be fixed separately.

## Git Hygiene
Existing unrelated Obsidian daily notes, workspace state, and git-log notes were present before this task. They were not staged for the stress-vector commit.
