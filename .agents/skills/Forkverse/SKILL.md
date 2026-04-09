---
name: forkverse
description: "ForkVerse product conventions for API design, simulations, Supabase, Telegram bot behavior, charts, and Vercel serverless deployment."
argument-hint: "[area] [task]"
license: Proprietary
metadata:
  author: local
  version: "1.0.0"
---

# ForkVerse

Use this skill when the task is specific to the ForkVerse product, architecture, or delivery rules.

## When To Use

- Backend or API changes that must follow ForkVerse response envelopes and data contracts
- Supabase schema, RLS, service-role, or usage-tracking work
- Telegram bot behavior, webhook flow, or check-in logic
- Simulation or data-processing work tied to ForkVerse domain rules
- Recharts or analytics views that visualize ForkVerse simulation output
- Vercel Python/serverless deployment decisions for ForkVerse services

## Workflow

1. Start by naming the relevant ForkVerse sub-guides you are applying and why.
2. Read only the topic files needed for the current task from this directory.
3. Treat those topic files as the product-specific source of truth for implementation choices.
4. If a task spans multiple areas, combine all relevant sub-guides before editing code.

## Topic Files

- `api-design.md`
- `data-visualization.md`
- `python-data-science.md`
- `supabase.md`
- `telegram-bot.md`
- `vercel-serverless.md`

## Rules

- Prefer the ForkVerse guide files over generic habits when they conflict.
- Do not invent alternative product rules when a relevant topic file already defines them.
- Keep outputs consistent with the existing ForkVerse contract and operational style.
