# Obsidian-AutoLogger

Backlinks: [[MonteRun MOC]] · [[02-Areas/Knowledge-Operations]] · [[Daily Notes/2026-04-12]]

## Purpose
Фиксирует правило, по которому каждый будущий commit/fix оставляет след и в Daily Notes, и в Inbox git log.

## Mechanism
- Hook bundle: `.githooks/post-commit`, `.githooks/post-rewrite`, `.githooks/post-merge`
- Script: `scripts/obsidian-autolog.ps1`
- Config: `.monterun/obsidian-autolog.json`
- Daily target: `Daily Notes/YYYY-MM-DD.md`
- Inbox target: `00-Inbox/Git Log/YYYY-MM-DD/HHmmss-shortsha-slug.md`

## Linked Flow
- Main hub: [[MonteRun MOC]]
- Daily note: [[Daily Notes/2026-04-12]]
- Project status: [[01-Projects/MonteRun/Current-Status]]
- Commit trace seed: [[00-Inbox/Git Log/2026-04-12/120000-second-brain-setup]]
