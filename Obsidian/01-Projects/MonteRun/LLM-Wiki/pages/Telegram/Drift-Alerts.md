---
type: compiled-wiki-page
project: MonteRun
area: telegram
status: active
updated: 2026-05-08
sources:
  - [[01-Projects/MonteRun/CURRENT-STATE]]
  - [[01-Projects/MonteRun/DECISIONS]]
  - [[01-Projects/MonteRun/Specs/08_MonteRun_Telegram_Bot_Layer_Spec]]
---

# Drift Alerts

## Current Synthesis

Telegram is the current retention loop, but the launch-hardened implementation is intentionally lightweight. It is a 7-day drift alert, not a speculative multi-step agent dialogue.

## Current Behavior

- Telegram `/start` can register a lightweight alert.
- Supabase stores rows in `user_alerts`.
- Stored alert data includes Telegram id, runway snapshot, creation time, and ping status.
- Raw scenario text and verdict copy are not stored for this loop.
- Protected `/api/cron/drift` checks due rows.
- Telegram `sendMessage` sends the 7-day survival prompt.

## What Agents Must Preserve

- Do not imply a shipped multi-agent retention backend.
- Do not store raw scenario text unless a future explicit privacy decision allows it.
- Keep Telegram as retention infrastructure, not a side novelty.
- Keep cron protected.

## Adjacent Pages

- [[01-Projects/MonteRun/LLM-Wiki/pages/Architecture/Deterministic-Pipeline]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Product/User-And-Jobs]]
- [[01-Projects/MonteRun/LLM-Wiki/pages/Decisions/Non-Negotiables]]
