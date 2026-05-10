---
type: llm-wiki-log
project: MonteRun
updated: 2026-05-10
status: active
owner: agent
---

# MonteRun LLM Wiki Log

Append-only timeline of LLM Wiki maintenance. Use headings that are easy to grep:

```text
## [YYYY-MM-DD] action | short title
```

## [2026-05-10] ingest | Monthly Telegram drift cron and Supabase migration path

Updated canonical current-state/decision notes and the compiled Telegram Drift Alerts page after `/api/cron/drift` moved to a 30-day monthly reminder. Documented that production Supabase now has `public.user_alerts`, that the cron marks successful sends with `last_pinged_at`, and that local SQL migration execution uses `SUPABASE_DB_URL` with the free shared pooler rather than the paid dedicated IPv4 add-on.

## [2026-05-10] ingest | Delta Share Card lightweight launch path

Updated the compiled sharing and deterministic-pipeline pages after the shipped Delta Share Card implementation. The launch path now documents browser `localStorage` baseline storage under `monterun_baseline_months` and client-side X/Twitter web intent sharing without server-side `/api/og` card generation.

## [2026-05-08] bootstrap | Karpathy-style LLM Wiki v0

Created the MonteRun LLM Wiki structure under `Obsidian/01-Projects/MonteRun/LLM-Wiki`.

Raw sources consulted:

- [[01-Projects/MonteRun/PROJECT]]
- [[01-Projects/MonteRun/CURRENT-STATE]]
- [[01-Projects/MonteRun/DECISIONS]]
- [[01-Projects/MonteRun/Specs/00_MonteRun_Function_Document_Map]]
- [[01-Projects/MonteRun/Specs/MonteRun_PRD]]
- Andrej Karpathy `llm-wiki.md` gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

Pages created:

- [[01-Projects/MonteRun/LLM-Wiki/SCHEMA]]
- [[01-Projects/MonteRun/LLM-Wiki/index]]
- [[01-Projects/MonteRun/LLM-Wiki/sources/Source-Registry]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Product/Product-Thesis]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Product/User-And-Jobs]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/Deterministic-Pipeline]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/LLM-Boundary]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Simulation/Math-Core]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Parser/Fast-Extraction]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/UI/Main-Screen]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Sharing/Delta-Share-Card]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Telegram/Drift-Alerts]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Growth/Acquisition-Loop]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Decisions/Non-Negotiables]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Open-Questions]]

Related repo setup:

- Added project-local skill `C:\ForkVerse\.agents\skills\monterun-wiki`.
- Updated `C:\ForkVerse\AGENTS.md` to route MonteRun knowledge-memory tasks through the LLM Wiki.

Open follow-up:

- Ingest all individual feature specs into dedicated compiled pages.
- Add a lint pass after the current uncommitted launch-hardening changes settle.
