---
type: compiled-wiki-page
project: MonteRun
area: product
status: active
updated: 2026-05-08
sources:
  - [[01-Projects/MonteRun/PROJECT]]
  - [[01-Projects/MonteRun/CURRENT-STATE]]
  - [[01-Projects/MonteRun/Specs/MonteRun_PRD]]
---

# Product Thesis

## Current Synthesis

MonteRun is a deterministic financial survival engine. It takes a user's plain-language financial scenario, extracts structured inputs, runs deterministic Monte Carlo simulation, and returns runway, survival probability, downside risk, and high-impact levers.

The product thesis is anti-copium: users should see how long they really last when bad months, delayed income, or shocks are modeled. Tone can be sharp, dry, and viral, but math must stay boring, auditable, and owned by code.

The core product loop:

1. User describes plan, cash, income, burn, delays, and shocks.
2. Parser extracts structured JSON.
3. Deterministic simulation computes paths, runway, survival, stress, and lever impact.
4. UI shows verdict, survival rate, chart, and actionable deltas.
5. Sharing and Telegram bring the user back when reality changes.

## Product Promise

Show how long the user can actually survive if self-deception is removed and bad months are modeled.

## What Agents Must Preserve

- MonteRun is not an AI fortune teller.
- The output is probability, runway, risk, and survival odds.
- The LLM may parse and phrase; it does not compute outcomes.
- The dry verdict supports the math; it does not replace the math.
- Retention beats virality, math beats tone, scenario clarity beats feature breadth.

## Adjacent Pages

- [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/Deterministic-Pipeline]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/LLM-Boundary]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Simulation/Math-Core]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/UI/Main-Screen]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Decisions/Non-Negotiables]]

## Open Questions

- Which tone mode becomes the default paid-product voice after launch telemetry?
- Which retention loop matters more after first use: Telegram checks, saved scenario history, or share-card return traffic?
