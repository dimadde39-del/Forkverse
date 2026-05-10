---
type: compiled-wiki-page
project: MonteRun
area: sharing
status: active
updated: 2026-05-10
sources:
  - [[01-Projects/MonteRun/CURRENT-STATE]]
  - [[01-Projects/MonteRun/DECISIONS]]
  - [[01-Projects/MonteRun/Specs/07_MonteRun_Share_Card_Generator_Spec]]
---

# Delta Share Card

## Current Synthesis

Delta Share Card is a shipped launch surface. It is not a future idea. The app stores the baseline runway months locally in browser `localStorage` under `monterun_baseline_months`, renders `DeltaShareCard.tsx`, and shares positive runway deltas through a client-side X/Twitter web intent opened in a new tab.

## Current Behavior

- Baseline runway months live in browser `localStorage`, not a server database.
- The current storage key is `monterun_baseline_months`.
- `DeltaShareCard.tsx` renders only for positive runway deltas.
- The share action opens an X/Twitter web intent in a new tab.
- The launch path does not generate `/api/og` cards, which keeps Vercel resource use low.

## What Agents Must Preserve

- Do not turn share URLs into raw financial data dumps.
- Keep the guardrail visible: simulation estimate, not financial advice.
- Do not move the baseline into a server database without an explicit product decision.
- Do not route this lightweight share action through server-side card generation by default.

## Adjacent Pages

- [[01-Projects/MonteRun/LLM-Wiki/pages/UI/Main-Screen]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Product/Product-Thesis]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Decisions/Non-Negotiables]]
