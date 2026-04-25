# Income Delay Time Masks - Validation

Date: 2026-04-25
Role: ParanoidValidator
Scope: income_delay_months propagation from parser/API/UI into deterministic NumPy simulator.

## Verdict
PASS. No blocking issues found.

## Diff Inspection
- `engine/monte_carlo.py`: income delay is applied through `TimeMasks` and NumPy broadcast multiplication. Delay is clamped to `[0, months]`; delay larger than horizon safely zeroes income for all simulated months. No new Python loop over months was introduced.
- `api/parse.py` and `prompts/parser_v1.txt`: parser instruction includes exact wording: "Extract how many months the user will wait before their first revenue. Default is 0." Default behavior remains 0 when absent.
- `api/simulate.py`: request params normalize `income_delay_months` to a non-negative integer with default 0 before calling the engine. Invalid negative, boolean, and fractional/string values are rejected.
- `components/SimulatorClient.tsx` and `components/WhatIfControls.tsx`: UI state includes `income_delay_months`, clamps to 0-12 and horizon, and uses existing debounced simulation path. Label is `Задержка дохода (мес)`.

## Validation Commands
- `python -m py_compile engine\monte_carlo.py api\parse.py api\simulate.py` -> PASS
- Focused Python invariant script -> PASS
  - delay 3 keeps first three income months inactive for every path
  - delay 99 clamps to horizon without out-of-bounds access
  - API default is 0 when missing
  - API rejects negative, bool, fractional, and non-numeric delay values
  - metrics remain JSON-serializable and bounded spaghetti sample stays <= 50
- `npx tsc --noEmit` -> PASS
- `npm run build` -> PASS
- `git diff --check -- engine/monte_carlo.py api/parse.py api/simulate.py prompts/parser_v1.txt components/SimulatorClient.tsx components/WhatIfControls.tsx` -> PASS, with CRLF normalization warnings only

## Risks Checked
- Out-of-bounds delay: not found; delay clamps to horizon.
- Missing defaults: not found in parser/API/UI paths inspected.
- UI crash risks: not found; non-finite delay is sanitized to 0 before binding.
- Raw matrices returned: existing `spaghetti_sample` remains sampled output, not full path matrix.
- Deterministic math boundary: preserved; LLM parser boundary only.

## Git Hygiene
Created this report as a new note to avoid touching pre-existing dirty Daily Notes or Obsidian workspace files.
