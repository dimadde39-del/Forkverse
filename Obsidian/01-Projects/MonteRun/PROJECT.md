# MonteRun Project Canon

_Last canonical update: 2026-04-14_

## Essence
MonteRun is a deterministic survival engine, not an AI fortune teller.
It takes structured user inputs, runs Monte Carlo simulation, and returns a dry mathematical estimate of where the user is likely to land over time.

## Core Thesis
- The product compiles reality, not vibes.
- The output is probability, runway, risk, and survival odds.
- The system is allowed to be sharp in tone, but never fuzzy in math.

## Stable Architecture
- Rule of One Gasket: one LLM boundary at most.
- LLM handles parsing and phrasing only.
- User input becomes structured JSON.
- The deterministic simulation core owns the math.
- Results are rendered as verdict, survival rate, and actionable deltas.

## Product Loop
- User describes the plan, runway, income, and burn.
- The parser extracts facts and assumptions.
- Monte Carlo simulation computes branches and survival odds.
- The product returns a dry verdict and shows what changes improve survival.
- Telegram micro-interrogations refresh the model and keep the loop alive.

## Signature Experience
- Dry verdict instead of soft motivation.
- Survival-rate framing instead of generic advice.
- Roast-like tone when exposing costly behavior.
- Viral presentation layered on top of real math.

## Non-Negotiables
- The math core stays deterministic and testable.
- LLM never owns the probability, risk model, or final outcome.
- No multi-agent backend chain.
- Telegram retention is part of the product, not an add-on.
- Brand language may evolve, but the engine logic stays the same.
