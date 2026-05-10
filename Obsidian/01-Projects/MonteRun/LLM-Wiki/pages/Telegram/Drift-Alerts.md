---
type: compiled-wiki-page
project: MonteRun
area: telegram
status: active
updated: 2026-05-10
sources:
  - [[01-Projects/MonteRun/CURRENT-STATE]]
  - [[01-Projects/MonteRun/DECISIONS]]
  - [[01-Projects/MonteRun/Specs/08_MonteRun_Telegram_Bot_Layer_Spec]]
---

# Drift Alerts

## Current Synthesis

Telegram is the current retention loop, but the launch-hardened implementation is intentionally lightweight. It is now a monthly drift alert through Supabase `user_alerts` and `/api/cron/drift`, not a speculative multi-step agent dialogue.

## Current Behavior

- Telegram `/start` can register a lightweight alert in `public.user_alerts`.
- Stored alert data includes Telegram id, runway snapshot, creation time, and ping status.
- Raw scenario text and verdict copy are not stored for this loop.
- Protected `GET /api/cron/drift` checks rows older than 30 days with `last_pinged_at is null`.
- The cron sends the monthly Russian runway recalculation prompt through Telegram `sendMessage` using native `fetch`.
- After a successful send, the cron patches `last_pinged_at` so the same row is not spammed on the next run.
- One failed Telegram send or Supabase patch increments `failed` and does not stop later rows.

## Supabase Operations

- `public.user_alerts` exists in production Supabase with RLS enabled and an index on `created_at where last_pinged_at is null`.
- Local migrations can be applied with `npm run supabase:migrate:user-alerts` after `SUPABASE_DB_URL` is set in `.env`.
- The working local database URL uses the free shared pooler, not the paid dedicated IPv4 add-on.

## What Agents Must Preserve

- Do not imply a shipped multi-agent retention backend.
- Do not store raw scenario text unless a future explicit privacy decision allows it.
- Keep Telegram as retention infrastructure, not a side novelty.
- Keep cron protected and service-role credentials server-side only.
- Do not switch back to the 7-day prompt unless a new explicit product decision says so.

## Adjacent Pages

- [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/Deterministic-Pipeline]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Product/User-And-Jobs]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Decisions/Non-Negotiables]]
