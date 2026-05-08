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
---

# LLM Boundary

## Current Synthesis

MonteRun follows the Rule of One Gasket: there is at most one LLM boundary. The LLM exists to translate human language into structured inputs and optionally produce short phrasing. It does not own the model of reality.

## Allowed LLM Work

- Extract cash, income, burn, delay, shock, horizon, and assumptions from user text.
- Ask clarification questions when required inputs are missing or unsupported.
- Detect result language when needed.
- Produce short verdict/comment phrasing after deterministic results exist.
- Suggest assumption labels for stress controls when grounded in extracted facts.

## Forbidden LLM Work

- Calculating runway.
- Calculating survival probability.
- Ranking lever impact from vibes.
- Creating stress outcomes without deterministic simulation.
- Returning reasoning, formulas, markdown, or prose outside the expected JSON contract.
- Running multi-agent backend workflows.

## Launch Parser Rule

The parser must return compact raw JSON only. Reasoning-heavy output is a parser bug. If the LLM leaks analysis or prose, treat it as invalid output.

## Why This Exists

MonteRun sells trust through repeatable math. If the model owns probabilities, the product becomes AI fortune telling. If code owns probabilities, tone can be sharp without destroying credibility.

## Adjacent Pages

- [[01-Projects/MonteRun/LLM-Wiki/pages/Parser/Fast-Extraction]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Simulation/Math-Core]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Decisions/Non-Negotiables]]
