---
type: source-registry
project: MonteRun
updated: 2026-05-08
status: active
owner: agent
---

# Source Registry

This page points agents to raw sources. It is not the source of truth itself.

## Source Priority

| Priority | Source | Use For |
| --- | --- | --- |
| 1 | [[01-Projects/MonteRun/PROJECT]] | Product essence and non-negotiable architecture. |
| 2 | [[01-Projects/MonteRun/CURRENT-STATE]] | Current launch reality and shipped surfaces. |
| 3 | [[01-Projects/MonteRun/DECISIONS]] | Decisions future agents must not silently undo. |
| 4 | `C:\ForkVerse` implementation | Actual behavior when docs and code diverge. |
| 5 | [[01-Projects/MonteRun/Specs/00_MonteRun_Function_Document_Map]] | Spec map and conflict priority. |
| 6 | [[01-Projects/MonteRun/Specs/MonteRun_PRD]] | Product requirements and launch frame. |
| 7 | Individual feature specs in [[01-Projects/MonteRun/Specs]] | Feature-specific detail after reading the canonical trio. |
| 8 | [[01-Projects/MonteRun/LLM-Wiki/index]] and compiled pages | Agent-maintained synthesis, not canon. |

## Raw Source Folders

| Folder | Status | Notes |
| --- | --- | --- |
| `C:\ForkVerse\Obsidian\01-Projects\MonteRun\Specs` | active | Imported specs plus launch-hardening notes. |
| `C:\ForkVerse\Obsidian\01-Projects\MonteRun\Logs` | active | Use when a task depends on historical execution context. |
| `C:\ForkVerse\Obsidian\01-Projects\MonteRun\Validation` | active | Use for UAT and verification memory. |
| `C:\ForkVerse` | active | Code, tests, prompts, and deployment config. |

## External Pattern Source

- Andrej Karpathy `llm-wiki.md` gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

Use this only for the wiki operating pattern. Do not let it override MonteRun product canon.

## Ingest Queue

- [[01-Projects/MonteRun/Specs/01_MonteRun_Input_And_Onboarding_Spec]]
- [[01-Projects/MonteRun/Specs/02_MonteRun_Runway_And_Survival_Engine_Spec]]
- [[01-Projects/MonteRun/Specs/03_MonteRun_Levers_Engine_And_Main_Screen_Spec]]
- [[01-Projects/MonteRun/Specs/04_MonteRun_Stress_Modes_Spec]]
- [[01-Projects/MonteRun/Specs/05_MonteRun_Verdict_Voice_Layer_Spec]]
- [[01-Projects/MonteRun/Specs/06_MonteRun_Scenario_Recalculation_And_History_Spec]]
- [[01-Projects/MonteRun/Specs/07_MonteRun_Share_Card_Generator_Spec]]
- [[01-Projects/MonteRun/Specs/08_MonteRun_Telegram_Bot_Layer_Spec]]
- [[01-Projects/MonteRun/Specs/09_MonteRun_Landing_Page_And_Acquisition_Spec]]
- [[01-Projects/MonteRun/Specs/10_MonteRun_Analytics_And_Event_Tracking_Spec]]
- [[01-Projects/MonteRun/Specs/11_MonteRun_White_Label_Readiness_Spec]]

## Registry Maintenance

- Add a source here when it should be reused by future agents.
- Do not add every temporary chat artifact.
- Mark stale sources instead of deleting them when they explain history.
