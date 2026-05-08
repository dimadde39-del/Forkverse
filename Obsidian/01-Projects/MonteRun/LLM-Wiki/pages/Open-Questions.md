---
type: compiled-wiki-page
project: MonteRun
area: operations
status: active
updated: 2026-05-08
sources:
  - [[01-Projects/MonteRun/CURRENT-STATE]]
  - [[01-Projects/MonteRun/Specs/MonteRun_PRD]]
---

# Open Questions

This page tracks durable unknowns. Do not invent answers when a question belongs here.

## Product

- Which tone mode becomes default after launch telemetry?
- What exact activation event best predicts retention: first lever apply, stress-mode run, share card open, or Telegram opt-in?
- Should the paid loop center on saved scenario history, Telegram drift checks, or richer recalculation reports?

## Parser

- What is the minimum reliable parser latency target after real traffic, not just smoke tests?
- Which unsupported currency and money-slang cases deserve first-class product copy?

## Simulation

- Which stress modes should remain visible in the MVP UI versus inferred from assumptions?
- How should confidence be represented for levers whose effect depends on outside-world behavior?

## Sharing

- What is the final production domain for share URLs and OG metadata?
- What level of delta detail is viral without leaking sensitive financial context?

## Telegram

- Does 7-day drift timing maximize return behavior, or should cadence depend on runway severity?
- What is the minimal safe context needed for a useful Telegram recalculation without storing raw scenario text?

## Wiki Maintenance

- Ingest the remaining individual specs into more detailed compiled pages.
- Add an automated or semi-automated lint routine if the wiki grows beyond manual index use.
- Decide whether implementation summaries like `SimulatorClient.tsx.md` should be folded into this LLM Wiki or archived as older notes.
