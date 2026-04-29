# Drift Cron Dispatcher

Date: 2026-04-29
Owner: CronDispatcher + Codex integration

## Implemented
- Added `GET /api/cron/drift` as a protected Vercel Cron endpoint.
- Auth is fail-closed with `Authorization: Bearer ${CRON_SECRET}`.
- Reads due `user_alerts` rows where `created_at` is older than 7 days and `last_pinged_at` is null.
- Uses only `telegram_id` and `last_runway_months`; no raw user text is read or stored.
- Sends Telegram message exactly: `It's been a week. Is your startup still alive? Update your numbers.`
- Updates `last_pinged_at` only after Telegram `sendMessage` succeeds.
- Added Vercel Cron schedule `0 3 * * *` for `/api/cron/drift`; the daily dispatcher catches plans once they cross the 7-day threshold.
- The Telegram `/start` flow resets `created_at` and clears `last_pinged_at` when a user tracks a new plan.

## Required Environment
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`
- `CRON_SECRET`

## Privacy Boundary
- The start token stores only runway tenths in the format `mr1_<base36 runway_tenths>`.
- Raw scenario text, verdict copy, comments, and URL params are not stored in Supabase.
