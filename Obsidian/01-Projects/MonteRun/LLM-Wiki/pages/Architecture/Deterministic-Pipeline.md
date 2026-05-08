---
type: compiled-wiki-page
project: MonteRun
area: architecture
status: active
updated: 2026-05-08
sources:
  - [[01-Projects/MonteRun/PROJECT]]
  - [[01-Projects/MonteRun/CURRENT-STATE]]
  - [[01-Projects/MonteRun/DECISIONS]]
  - [[01-Projects/MonteRun/Specs/MonteRun_PRD]]
---

# Deterministic Pipeline

## Current Synthesis

MonteRun uses one narrow LLM boundary and a deterministic computation core.

Pipeline:

1. User describes a financial scenario.
2. Parser extracts structured facts and assumptions.
3. Validation rejects unsupported or unsafe inputs before fake math is shown.
4. Simulation core computes runway, survival probability, percentile paths, stress outcomes, and lever impact.
5. Presentation layer renders verdict, chart, levers, share card, and Telegram handoff.
6. Retention layer can send a lightweight 7-day drift prompt through Telegram.

## Responsibility Boundaries

| Layer | Owns | Must Not Own |
| --- | --- | --- |
| Parser / LLM | Extraction, short phrasing, language detection, clarification prompts | Probability, runway, lever impact, final math |
| Simulation core | Monte Carlo paths, runway, survival, stress, lever math | Copy tone, product claims |
| UI | Input, result rendering, chart, levers, share affordances | Math mutation outside explicit user controls |
| Share/OG | URL snapshot rendering and share metadata | Raw financial input storage in share URLs |
| Telegram | Lightweight drift alert registration and check-in | Multi-agent coaching chain |

## Current Shipped Surfaces

- Fast parser extraction path.
- Delta Share Card with baseline/latest state.
- `/share` page and dynamic `/api/og` image.
- Telegram Drift Alerts through Supabase `user_alerts` and protected cron.

## What Agents Must Preserve

- Do not add another backend LLM hop.
- Do not let verdict copy replace numeric output.
- Do not serialize raw financial inputs into share URLs unless a future explicit decision changes the privacy model.
- Verify implementation when docs are older than code.

## Adjacent Pages

- [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/LLM-Boundary]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Simulation/Math-Core]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Parser/Fast-Extraction]]
