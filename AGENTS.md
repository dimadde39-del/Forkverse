# Project Conventions

- Use the `obsidian` MCP server for note, memory, and documentation tasks that belong in the project vault at `Obsidian`.
- Prefer project-local skills from `.agents/skills` when they match the task. Use the `monterun` skill for product-specific architecture, API, data, Telegram bot, and deployment conventions.
- Use the `monterun-wiki` skill for MonteRun project memory, source ingest, durable documentation, Karpathy-style LLM Wiki work, query/lint/compile workflows, and synthesis across notes, specs, code, decisions, and implementation history.
- Keep only real skills in `.agents/skills`. If a directory does not contain `SKILL.md`, it belongs somewhere else such as `.agents/vendor`.
- Before any MonteRun task, first read `C:\ForkVerse\Obsidian\01-Projects\MonteRun\PROJECT.md`, `C:\ForkVerse\Obsidian\01-Projects\MonteRun\CURRENT-STATE.md`, and `C:\ForkVerse\Obsidian\01-Projects\MonteRun\DECISIONS.md`. Treat them as the only source of truth.
- For MonteRun knowledge-memory tasks, after the canonical trio read `C:\ForkVerse\Obsidian\01-Projects\MonteRun\LLM-Wiki\SCHEMA.md` and `C:\ForkVerse\Obsidian\01-Projects\MonteRun\LLM-Wiki\index.md`. Treat `LLM-Wiki` as agent-maintained compiled memory, not as a higher source of truth than canon.
- If the task is feature-specific, then read the relevant note under `C:\ForkVerse\Obsidian\01-Projects\MonteRun\Specs\` after the canonical trio.
