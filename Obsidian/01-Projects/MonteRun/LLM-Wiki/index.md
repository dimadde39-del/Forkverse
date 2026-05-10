---
type: llm-wiki-index
project: MonteRun
updated: 2026-05-10
status: active
owner: agent
---

# MonteRun LLM Wiki Index

Start here after reading the canonical trio:

- [[01-Projects/MonteRun/PROJECT]]
- [[01-Projects/MonteRun/CURRENT-STATE]]
- [[01-Projects/MonteRun/DECISIONS]]

Then use this index to open only the pages relevant to the task.

## Operating Files

| Page | Purpose |
| --- | --- |
| [[01-Projects/MonteRun/LLM-Wiki/SCHEMA]] | Agent contract for maintaining the wiki. |
| [[01-Projects/MonteRun/LLM-Wiki/log]] | Chronological record of wiki ingests, queries, and lint passes. |
| [[01-Projects/MonteRun/LLM-Wiki/sources/Source-Registry]] | Pointers to raw sources and their priority. |

## Product

| Page | Summary |
| --- | --- |
| [[01-Projects/MonteRun/LLM-Wiki/pages/Product/Product-Thesis]] | MonteRun's durable product identity, promise, user loop, and anti-copium positioning. |
| [[01-Projects/MonteRun/LLM-Wiki/pages/Product/User-And-Jobs]] | Primary user, jobs-to-be-done, and launch success signals. |

## Architecture

| Page | Summary |
| --- | --- |
| [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/Deterministic-Pipeline]] | End-to-end system boundary: input -> parse -> deterministic simulation -> presentation -> retention. |
| [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/LLM-Boundary]] | The one-gasket rule and what the model may and may not own. |

## Simulation And Parser

| Page | Summary |
| --- | --- |
| [[01-Projects/MonteRun/LLM-Wiki/pages/Simulation/Math-Core]] | Deterministic runway, survival, stress, and lever ownership rules. |
| [[01-Projects/MonteRun/LLM-Wiki/pages/Parser/Fast-Extraction]] | Parser SLA, raw JSON rule, supported responsibilities, and failure boundaries. |

## Product Surfaces

| Page | Summary |
| --- | --- |
| [[01-Projects/MonteRun/LLM-Wiki/pages/UI/Main-Screen]] | Main screen hierarchy, first-screen input, chart, levers, verdict, and share affordances. |
| [[01-Projects/MonteRun/LLM-Wiki/pages/Sharing/Delta-Share-Card]] | Browser `localStorage` baseline and client-side X/Twitter web intent sharing. |
| [[01-Projects/MonteRun/LLM-Wiki/pages/Telegram/Drift-Alerts]] | Monthly Telegram retention loop through Supabase `user_alerts`, protected cron, and native `fetch`. |
| [[01-Projects/MonteRun/LLM-Wiki/pages/Growth/Acquisition-Loop]] | Launch acquisition thesis and what the landing surface must communicate. |

## Decisions And Gaps

| Page | Summary |
| --- | --- |
| [[01-Projects/MonteRun/LLM-Wiki/pages/Decisions/Non-Negotiables]] | Compact agent checklist of decisions that should not be silently undone. |
| [[01-Projects/MonteRun/LLM-Wiki/pages/Open-Questions]] | Questions, gaps, and future research items that should not be invented away. |

## Current High-Priority Agent Routes

| Task Type | Read First |
| --- | --- |
| Product positioning or copy | Product-Thesis, Main-Screen, Acquisition-Loop, Non-Negotiables |
| Parser/API work | LLM-Boundary, Fast-Extraction, Deterministic-Pipeline |
| Simulation/math work | Math-Core, Deterministic-Pipeline, Non-Negotiables |
| Share card/OG work | Delta-Share-Card, Main-Screen |
| Telegram work | Drift-Alerts, Deterministic-Pipeline |
| Wiki maintenance | SCHEMA, Source-Registry, log |

## Index Maintenance Rules

- Add every durable compiled page here.
- Keep summaries one line long.
- Update `updated` frontmatter when this index changes.
- Do not remove old links silently; mark stale pages as `stale` first unless deleting obvious scratch material.
