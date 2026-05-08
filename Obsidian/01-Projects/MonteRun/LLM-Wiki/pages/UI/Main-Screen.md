---
type: compiled-wiki-page
project: MonteRun
area: ui
status: active
updated: 2026-05-08
sources:
  - [[01-Projects/MonteRun/Specs/01_MonteRun_Input_And_Onboarding_Spec]]
  - [[01-Projects/MonteRun/Specs/03_MonteRun_Levers_Engine_And_Main_Screen_Spec]]
  - [[01-Projects/MonteRun/Specs/09_MonteRun_Landing_Page_And_Acquisition_Spec]]
---

# Main Screen

## Current Synthesis

The main screen must make scenario entry obvious, especially on mobile. A new user should immediately know where to type their financial situation before seeing charts, results, or marketing blocks.

Once results exist, the main screen should prioritize useful control over pure verdict impact:

1. Runway as the dominant number.
2. Base vs stress comparison.
3. Top levers by impact.
4. Scenario/stress controls.
5. Verdict block.
6. Share and recalculate actions.

## First-Screen Input Rule

For alpha usability, mobile first screen should show:

- CTA/label: `Describe your financial scenario`.
- A visible input box.
- A visible run button.
- A concrete example placeholder.

The user should not need to scroll to discover the input.

## Chart Rule

The chart is a mathematical verdict surface, not decoration. Mobile layout may simplify surrounding details, but the graph itself must not become a tiny compressed strip.

Preferred mobile behavior:

- Increase chart height.
- Allow horizontal breathing room or scroll when needed.
- Hide non-critical detail chips before shrinking the graph into unreadability.
- Keep negative zones visible.
- Keep tooltip usable.

## Agent Caution

Do not add marketing-style landing sections ahead of the working input. MonteRun's first screen should be the usable product surface.

## Adjacent Pages

- [[01-Projects/MonteRun/LLM-Wiki/pages/Product/User-And-Jobs]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Simulation/Math-Core]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Sharing/Delta-Share-Card]]
