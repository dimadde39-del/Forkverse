---
type: compiled-wiki-page
project: MonteRun
area: simulation
status: active
updated: 2026-05-08
sources:
  - [[01-Projects/MonteRun/PROJECT]]
  - [[01-Projects/MonteRun/DECISIONS]]
  - [[01-Projects/MonteRun/Specs/02_MonteRun_Runway_And_Survival_Engine_Spec]]
  - [[01-Projects/MonteRun/Specs/03_MonteRun_Levers_Engine_And_Main_Screen_Spec]]
---

# Math Core

## Current Synthesis

The MonteRun math core is deterministic, auditable, and separate from the LLM. It computes survival through Monte Carlo paths and exposes interpretable outputs: runway, survival probability, percentile bands, sample trajectories, and lever impacts.

## Core Outputs

- Base runway in months.
- Survival probability, especially 12-month survival framing.
- Percentile paths: p10, p50, p90.
- Spaghetti sample trajectories for chart texture.
- Stress-adjusted outcomes.
- Lever impact measured in months or survival delta.

## Lever Rule

Levers must be ranked by deterministic impact, not handcrafted copy. The useful lever loop is:

1. Apply explicit math patch.
2. Re-run or derive deterministic effect.
3. Show impact, effort, and time-to-effect when available.
4. Let the user apply the lever and see what changes.

## Chart Rule

The chart should preserve mathematical meaning:

- p10 <= p50 <= p90 for each month.
- Negative balances are allowed and must remain visible.
- Spaghetti lines must not overpower median or percentile band.
- The chart can simplify non-critical labels on mobile, but not distort data.

## What Agents Must Preserve

- Never move probability ownership into prompt text.
- Do not fake survival when required inputs are missing.
- Do not silently cap, coerce, or invent financial facts unless the API contract explicitly defines the behavior.
- Tests are the memory of this layer. Expand tests when changing shared math behavior.

## Adjacent Pages

- [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/Deterministic-Pipeline]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/LLM-Boundary]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/UI/Main-Screen]]
