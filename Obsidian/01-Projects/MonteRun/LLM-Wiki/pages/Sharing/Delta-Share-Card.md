---
type: compiled-wiki-page
project: MonteRun
area: sharing
status: active
updated: 2026-05-08
sources:
  - [[01-Projects/MonteRun/CURRENT-STATE]]
  - [[01-Projects/MonteRun/DECISIONS]]
  - [[01-Projects/MonteRun/Specs/07_MonteRun_Share_Card_Generator_Spec]]
---

# Delta Share Card

## Current Synthesis

Delta Share Card is a shipped launch surface. It is not a future idea. The app stores baseline/latest result state locally, pushes safe result metrics into share URL params, renders `/share`, and serves a dynamic `/api/og` image.

## Current Behavior

- Baseline/latest result state lives in browser localStorage.
- Share URLs carry result metrics and verdict/delta state.
- Share URLs should avoid serializing raw financial inputs.
- `/share` renders a share page with server-side metadata.
- `/api/og` renders the OG image.
- Missing share params render a generic state instead of fake metrics.

## What Agents Must Preserve

- Do not turn share URLs into raw financial data dumps.
- Keep the guardrail visible: simulation estimate, not financial advice.
- Keep OG and share page labels consistent.
- Keep edited URL snapshots treated as unverified records.
- Prefer explicit result params over deriving fake metrics from missing inputs.

## Adjacent Pages

- [[01-Projects/MonteRun/LLM-Wiki/pages/UI/Main-Screen]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Product/Product-Thesis]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Decisions/Non-Negotiables]]
