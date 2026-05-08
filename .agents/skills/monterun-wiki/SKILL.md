---
name: monterun-wiki
description: "Maintain and query the MonteRun LLM Wiki in the Obsidian project vault. Use when the user asks for project memory, documentation, source ingest, Karpathy-style LLM wiki work, knowledge-base maintenance, wiki linting, durable answers, or synthesis across MonteRun notes, specs, code, decisions, and implementation history."
---

# MonteRun Wiki

Use this skill to operate the MonteRun LLM Wiki at:

```text
C:\ForkVerse\Obsidian\01-Projects\MonteRun\LLM-Wiki
```

The wiki is a compiled, agent-maintained memory layer. It is useful, but it is not the highest source of truth.

## Required Orientation

Before any MonteRun wiki task, read these canonical files first:

```text
C:\ForkVerse\Obsidian\01-Projects\MonteRun\PROJECT.md
C:\ForkVerse\Obsidian\01-Projects\MonteRun\CURRENT-STATE.md
C:\ForkVerse\Obsidian\01-Projects\MonteRun\DECISIONS.md
```

Then read:

```text
C:\ForkVerse\Obsidian\01-Projects\MonteRun\LLM-Wiki\SCHEMA.md
C:\ForkVerse\Obsidian\01-Projects\MonteRun\LLM-Wiki\index.md
```

Use the `obsidian` MCP server for vault reads and writes whenever possible.

## Source Priority

Resolve conflicts in this order:

1. Canonical trio: `PROJECT.md`, `CURRENT-STATE.md`, `DECISIONS.md`
2. Current implementation in `C:\ForkVerse`
3. Feature specs in `Obsidian\01-Projects\MonteRun\Specs`
4. Compiled pages in `LLM-Wiki`
5. Conversation assumptions

If the wiki conflicts with the canonical trio, update the wiki. Do not silently rewrite canon.

## Operations

### Query

Use when the user asks what is true, why a decision exists, how a subsystem works, or what the project memory says.

1. Read the canonical trio.
2. Read `LLM-Wiki\index.md`.
3. Open the minimal relevant compiled pages.
4. Verify against specs or code when the answer is consequential.
5. Answer with file links or Obsidian wikilinks when helpful.
6. If the answer is durable and reusable, file it back into the wiki and append `log.md`.

### Ingest

Use when the user adds a source, asks to remember something, or finishes work that should become project memory.

1. Identify raw source paths.
2. Extract decisions, constraints, facts, contradictions, and open questions.
3. Update existing pages before creating new pages.
4. Create a new page only for reusable concepts.
5. Update `index.md` for added, renamed, removed, or materially changed pages.
6. Append `log.md` with date, source, pages touched, and unresolved questions.

### Lint

Use when the user asks to audit, clean up, validate, or improve the wiki.

Check for:

- claims that conflict with the canonical trio
- stale ForkVerse wording outside historical context
- orphan pages with weak links
- important specs not represented in compiled pages
- stale launch assumptions after implementation changes
- missing log entries or index entries

### Compile

Use when a source should be transformed into a durable wiki page.

Preferred page structure:

```markdown
---
type: compiled-wiki-page
project: MonteRun
area: product | architecture | simulation | parser | ui | sharing | telegram | growth | decisions | operations
status: active | draft | stale | needs-review
updated: YYYY-MM-DD
sources:
  - [[01-Projects/MonteRun/PROJECT]]
---

# Page Title

## Current Synthesis
## What Agents Must Preserve
## Source Pointers
## Open Questions
```

## MonteRun Guardrails

Never let wiki work imply these are negotiable:

- MonteRun is a deterministic survival engine, not an AI fortune teller.
- LLM parses and phrases only.
- Code owns runway, probability, stress outcomes, and lever impact.
- Parser output must be fast, compact raw JSON only, and free of reasoning prose.
- No multi-agent backend chain.
- Telegram drift alerts are the current retention loop.
- Delta Share Card is shipped launch surface.
- Brand language may evolve, but math ownership does not.

## File Discipline

- Keep raw sources immutable unless the user explicitly asks to edit them.
- Keep compiled wiki pages concise and cross-linked.
- Prefer updating `Open-Questions.md` over inventing uncertain facts.
- Every wiki edit should update `log.md`.
- Every material page change should be discoverable from `index.md`.
