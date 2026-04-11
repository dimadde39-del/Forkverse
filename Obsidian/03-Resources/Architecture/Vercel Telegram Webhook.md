# Vercel Telegram Webhook

Backlinks: [[ForkVerse MOC]] · [[01-Projects/ForkVerse/Current-Status]] · [[03-Resources/Architecture/Parser-and-Simulation-Flow]] · [[Daily Notes/2026-04-12]]

## Purpose
Production-ready Telegram webhook for ForkVerse on Vercel Python runtime.

## Responsibilities
- Accept Telegram webhook updates in `api/tg_webhook.py`
- Reuse [[03-Resources/Architecture/Parser-and-Simulation-Flow]] with `telegram_user_id`
- Generate in-memory PNG charts with 50 spaghetti paths, P10/P50/P90 and a bankruptcy line
- Send the chart back to Telegram through Bot API
- Leave an audit trail in [[Daily Notes/2026-04-12]] and future AutoLogger traces

## Runtime Notes
- Uses the Vercel Python serverless `handler` class pattern already used in ForkVerse APIs
- Reads `TELEGRAM_BOT_TOKEN` only from environment
- Uses `telegram_context` and `scenario_state` as the state bridge into parsing and simulation

## Related Notes
- [[ForkVerse MOC]]
- [[01-Projects/ForkVerse/Current-Status]]
- [[03-Resources/Architecture/Parser-and-Simulation-Flow]]
- [[03-Resources/Simulations/Monte-Carlo-Engine]]
- [[Daily Notes/2026-04-12]]
