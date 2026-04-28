# Product Hunt Hardening - 2026-04-28

## Scope
- Optimized `api/parse.py` DeepSeek v4-flash calls for sub-10s parser response by disabling thinking mode, forbidding reasoning/prose before JSON, and capping output tokens.
- Synchronized simulator Survival display by routing the main screen, Share Card, and share URLs through the same normalized result metrics source.
- Removed the Escape Routes `0 MONTHS` display by precomputing display impact before render and falling back to deterministic patched-runway estimates when API impact is zero.
- Locked user-facing product and code prompt surfaces to English and USD (`$`) across simulator UI, What-if controls, Telegram captions/errors, parser prompts, legacy parser prompt, and the SMM chronicler prompt.

## Verification
- `python -m py_compile api\parse.py api\tg_webhook.py engine\monte_carlo.py` passed.
- `python -m py_compile scripts\agents\smm_chronicler.py` passed.
- `python -m unittest tests.test_parse_smart_levers tests.test_levers_engine` passed: 4 tests.
- `npx tsc --noEmit` passed.
- `npm run build` passed.
- Code scan across `api`, `app`, `components`, `engine`, `prompts`, `scripts`, `supabase`, and `tests` found no Cyrillic, ruble, tenge, KZT, or RUB.

## Timing Notes
- APIOptimizer live extraction measurement: 7563 ms, status ready, 3 smart levers, 2 assumptions.
- APIOptimizer live roast measurement: 4058 ms, 3 lever actions.
