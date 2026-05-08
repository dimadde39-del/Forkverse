---
type: compiled-wiki-page
project: MonteRun
area: parser
status: active
updated: 2026-05-08
sources:
  - [[01-Projects/MonteRun/CURRENT-STATE]]
  - [[01-Projects/MonteRun/DECISIONS]]
  - [[01-Projects/MonteRun/Specs/01_MonteRun_Input_And_Onboarding_Spec]]
---

# Fast Extraction

## Current Synthesis

The parser is launch-hardened for fast extraction. Its job is to turn user text into compact structured JSON and clarification prompts. It should feel immediate enough for launch smoke tests and must not emit reasoning prose.

## Parser Owns

- Structured input extraction.
- Missing critical input detection.
- Unsupported currency clarification.
- Assumption extraction.
- Language detection for result phrasing.
- Smart lever candidates only when represented as explicit math patches that the deterministic core can validate.

## Parser Does Not Own

- Final survival probability.
- Runway math.
- Stress result math.
- Lever impact math.
- Trust claims that are not backed by extracted facts.

## Launch Rules

- Target: sub-10-second extraction feel.
- Output: raw JSON only.
- No markdown.
- No analysis.
- No formulas.
- No chain-of-thought.
- No old brand mentions in visible generated copy.

## Failure Behavior

If user input cannot safely simulate, clarify instead of fabricating. Missing expenses, unsupported currency, or overloaded parser states should produce explicit user-facing failure or clarification, not fake confidence.

## Adjacent Pages

- [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/LLM-Boundary]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Simulation/Math-Core]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Product/User-And-Jobs]]
