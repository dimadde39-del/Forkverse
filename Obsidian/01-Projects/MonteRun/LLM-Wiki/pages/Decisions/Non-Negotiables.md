---
type: compiled-wiki-page
project: MonteRun
area: decisions
status: active
updated: 2026-05-08
sources:
  - [[01-Projects/MonteRun/PROJECT]]
  - [[01-Projects/MonteRun/CURRENT-STATE]]
  - [[01-Projects/MonteRun/DECISIONS]]
---

# Non-Negotiables

## Agent Checklist

Before changing product, code, prompts, docs, or wiki pages, preserve these decisions unless the user explicitly changes them:

- Product name is MonteRun. Old ForkVerse wording is historical only.
- Product essence: deterministic survival engine, not AI fortune teller.
- LLM parses and phrases only.
- Parser output must be fast, compact raw JSON only, without reasoning/prose.
- Code owns probability, runway, stress outcomes, and lever impact.
- Math core must stay deterministic, auditable, and testable.
- No multi-agent backend chain.
- Dry verdict and roast behavior are part of the product experience, but numbers lead.
- Telegram is the current retention infrastructure.
- Current Telegram loop is lightweight 7-day drift alert, not a multi-step coach.
- Delta Share Card is shipped launch surface.
- Raw scenario text is not stored for drift alerts.
- Share URLs should avoid raw financial input serialization.
- Canonical trio is source of truth over compiled wiki pages.

## Safe Change Pattern

If a requested change touches a non-negotiable:

1. Name the conflict.
2. Ask whether the user intends to change the decision.
3. If yes, update [[01-Projects/MonteRun/DECISIONS]] first or ask permission to do so.
4. Then update compiled wiki pages and implementation.

## Adjacent Pages

- [[01-Projects/MonteRun/LLM-Wiki/pages/Product/Product-Thesis]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/LLM-Boundary]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Simulation/Math-Core]]
