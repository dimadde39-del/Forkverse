# MonteRun Decisions

_Last updated: 2026-04-14_

| Date | Decision | Why | Consequence |
| --- | --- | --- | --- |
| 2026-04-14 | Rename `ForkVerse` to `MonteRun` without changing the product essence. | The new name is sharper and more viral while preserving the original thesis. | New docs, prompts, and product language should use `MonteRun`, but the architecture and strategy stay the same. |
| 2026-04-14 | Keep LLM as parser and response stylist only. | The product must remain deterministic, auditable, and cheap to reason about. | User language is converted into structured JSON, but the model never owns the simulation or final probability. |
| 2026-04-14 | Keep the math core deterministic and Monte Carlo-based. | Probabilities must come from repeatable computation, not model guesses. | The simulation engine remains testable, reproducible, and independent from LLM variability. |
| 2026-04-14 | Make dry verdict and roast behavior part of the product experience. | The project needs a hard emotional hook without giving up mathematical honesty. | Results can be sarcastic and brutal, but the underlying numbers must stay grounded. |
| 2026-04-14 | Use Telegram micro-interrogations as the retention loop. | Repeated small updates keep the model fresh and create subscription value. | The bot should ask targeted follow-ups that refresh the graph and probability over time. |
| 2026-04-14 | Do not build a multi-agent backend chain. | Extra agent hops increase cost, latency, opacity, and failure surface. | The backend should remain a single deterministic pipeline with one LLM boundary at most. |
