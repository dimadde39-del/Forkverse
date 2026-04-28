# MonteRun UI English + USD Lock

Date: 2026-04-28

- Locked user-facing MonteRun UI copy to English across simulator tooltips, composer placeholders, What-if controls, Telegram captions/errors, parser prompts, and legacy parser prompt text.
- Forced user-facing currency display and parser normalization to USD (`$`), replacing tenge formatting in Telegram and preventing non-USD symbols from parser/UI display.
- Confirmed required labels remain present: "Assumptions under pressure", "Escape Routes", "Survival", "Runway", "Monthly Burn", and "Apply stress".
- Verification: `python -m py_compile api\parse.py api\tg_webhook.py engine\monte_carlo.py`, `python -m unittest tests.test_parse_smart_levers tests.test_levers_engine`, `npx tsc --noEmit`, and `npm run build` passed.
