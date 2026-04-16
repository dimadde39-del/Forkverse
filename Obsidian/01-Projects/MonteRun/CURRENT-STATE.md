# MonteRun Current State

_Last updated: 2026-04-14_

## Project Name
MonteRun.

## Current Reality
- MonteRun is the renamed expression of the original ForkVerse thesis.
- The essence did not change: deterministic Monte Carlo engine, not AI fortune telling.
- The product direction is still built around shock, dry verdicts, survival rate, and visible downside.

## Backend Direction
- The backend is converging on one LLM boundary only.
- DeepSeek is the current language layer for parsing and response tone.
- The simulation core must stay deterministic, auditable, and separate from the model.
- Language can be sarcastic; math cannot be negotiable.

## Retention Direction
- Telegram remains the main habit loop.
- The bot should ask short follow-up questions that update the graph and probability.
- Subscription value comes from repeated recalculation against real user behavior.

## What Must Stay True
- `PROJECT.md` defines what MonteRun is.
- `CURRENT-STATE.md` defines what is happening now.
- `DECISIONS.md` records the important choices that future agents must not silently undo.

## Next Priorities
- Keep naming consistent across prompts, notes, and code.
- Preserve the deterministic math path while improving the language layer around it.
- Build from canonical project memory instead of relying on prior chat context.
- Protect the product from drift into multi-agent complexity or AI-guru behavior.

## Open Constraints
- Any LLM swap must preserve the parser-only rule.
- Any product copy change must preserve the dry-verdict positioning.
- Any backend change must keep simulation ownership in code, not in the model.
