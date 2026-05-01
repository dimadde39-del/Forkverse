# MonteRun Current State

_Last updated: 2026-05-01_

## Project Name
MonteRun.

## Current Reality
- MonteRun is the renamed expression of the original ForkVerse thesis.
- The essence did not change: deterministic Monte Carlo engine, not AI fortune telling.
- The launch-hardening build is now centered on fast parser extraction, delta sharing, and Telegram drift alerts.
- The product surface is still built around shock, dry verdicts, survival rate, and visible downside.

## Backend Direction
- The backend uses one LLM boundary only: DeepSeek extraction/phrasing.
- The parser is launch-hardened for fast extraction with a sub-10-second target; it must emit raw JSON only, with no reasoning, analysis, markdown, or explanatory prose.
- The simulation core must stay deterministic, auditable, and separate from the model.
- Language can be sarcastic; math cannot be negotiable.
- The LLM may parse user language and produce short phrasing, but it never owns probabilities, runway math, lever math, or final simulation outcomes.

## Launch-Hardened Features
- Delta Share Card exists: the app stores baseline/latest result state in localStorage, pushes baseline/latest metrics through URL params, renders `/share`, and serves a dynamic `/api/og` image.
- Telegram Drift Alerts exist: Telegram `/start` writes `user_alerts` in Supabase, `/api/cron/drift` checks due rows, and Telegram `sendMessage` sends the 7-day survival prompt.
- Drift alerts store only the Telegram id, runway snapshot, creation time, and ping status; raw scenario text and verdict copy are not stored for this loop.

## Retention Direction
- Telegram remains the main habit loop.
- The current launch loop is a lightweight 7-day drift alert, not a speculative multi-step agent dialogue.
- Subscription value still comes from repeated recalculation against real user behavior.

## What Must Stay True
- `PROJECT.md` defines what MonteRun is.
- `CURRENT-STATE.md` defines what is happening now.
- `DECISIONS.md` records the important choices that future agents must not silently undo.

## Next Priorities
- Keep naming consistent across prompts, notes, and code.
- Preserve the deterministic math path while keeping the parser fast and JSON-only.
- Build from canonical project memory instead of relying on prior chat context.
- Protect the product from drift into multi-agent complexity or AI-guru behavior.

## Open Constraints
- Any LLM swap must preserve the parser-only rule.
- Any product copy change must preserve the dry-verdict positioning.
- Any backend change must keep simulation ownership in code, not in the model.

## Reference Corpus
- Full product references now live in [[01-Projects/MonteRun/Specs]].
- Default deep-read order: PRD -> document map -> relevant feature spec.
- The imported planning corpus is now stored inside the project vault instead of living only as external `.docx` files.
