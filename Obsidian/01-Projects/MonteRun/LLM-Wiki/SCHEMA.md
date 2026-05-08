---
type: llm-wiki-schema
project: MonteRun
updated: 2026-05-08
status: active
owner: agent
---

# MonteRun LLM Wiki Schema

This file is the operating contract for the MonteRun LLM Wiki. It turns the project vault into an agent-maintained, persistent synthesis layer in the Karpathy LLM Wiki pattern.

## Source Priority

Always resolve truth in this order:

1. `C:\ForkVerse\Obsidian\01-Projects\MonteRun\PROJECT.md`
2. `C:\ForkVerse\Obsidian\01-Projects\MonteRun\CURRENT-STATE.md`
3. `C:\ForkVerse\Obsidian\01-Projects\MonteRun\DECISIONS.md`
4. Current implementation in `C:\ForkVerse`
5. Relevant files in `C:\ForkVerse\Obsidian\01-Projects\MonteRun\Specs\`
6. Compiled pages in this `LLM-Wiki`
7. Conversation memory and assumptions

The canonical trio overrides this wiki. If the wiki conflicts with the trio, update the wiki, not the trio, unless the user explicitly asks to change canon.

## Three Layers

- Raw sources: canonical trio, specs, implementation files, validation notes, logs, and user-provided source material. Do not silently rewrite raw sources.
- Compiled wiki: this `LLM-Wiki` directory. The agent may create, update, split, merge, and cross-link these pages.
- Schema: this file plus `C:\ForkVerse\.agents\skills\monterun-wiki\SKILL.md` and `C:\ForkVerse\AGENTS.md`.

## Required Agent Loop

For any MonteRun knowledge task:

1. Read the canonical trio first.
2. Read `LLM-Wiki/index.md`.
3. Open only the relevant compiled pages.
4. Open raw specs or code only when needed to verify or update a claim.
5. Answer from the highest-priority source available.
6. When the answer creates durable knowledge, file it back into the wiki.
7. Append a short entry to `LLM-Wiki/log.md` for every wiki edit.
8. Update `LLM-Wiki/index.md` whenever pages are added, removed, renamed, or materially changed.

## Page Format

Every compiled page should use this frontmatter:

```yaml
---
type: compiled-wiki-page
project: MonteRun
area: product | architecture | simulation | parser | ui | sharing | telegram | growth | decisions | operations
status: active | draft | stale | needs-review
updated: YYYY-MM-DD
sources:
  - [[01-Projects/MonteRun/PROJECT]]
---
```

Recommended sections:

- `# Page Title`
- `## Current Synthesis`
- `## What Agents Must Preserve`
- `## Source Pointers`
- `## Open Questions` when useful

## Linking Rules

- Use Obsidian wikilinks for vault notes.
- Prefer links to canonical trio and specs over copying long passages.
- Keep page names stable and descriptive.
- When a concept becomes important across two or more pages, create or update a dedicated concept page and link it.

## Ingest Workflow

Use this when the user adds a new note, source, code change, product decision, meeting note, or research input:

1. Identify the raw source path and whether it is canonical, spec, implementation, validation, or external.
2. Extract durable claims, decisions, constraints, and open questions.
3. Update existing pages before creating new pages.
4. Create a new page only when the concept will be reused.
5. Add or update links from `index.md`.
6. Add a log entry with source, pages touched, and unresolved questions.

## Query Workflow

Use this when the user asks a product, architecture, implementation, or strategy question:

1. Read `index.md`.
2. Read the minimal relevant compiled pages.
3. Verify against canonical trio and raw specs when the question is consequential.
4. Answer with source paths or wikilinks when helpful.
5. Ask whether to file the answer only if it is not obviously durable. If obviously durable, file it and log it.

## Lint Workflow

Periodically run a health pass:

- Find claims that conflict with the canonical trio.
- Find old ForkVerse wording that should now be MonteRun wording unless it is explicitly historical.
- Find pages without inbound or outbound links.
- Find important concepts in specs with no compiled page.
- Find stale launch assumptions after implementation changes.
- Propose sources to ingest next.

## MonteRun Invariants

Never let the wiki imply these are negotiable:

- MonteRun is a deterministic survival engine, not an AI fortune teller.
- The LLM parses and phrases only.
- Code owns runway, probability, stress outcomes, and lever impact.
- Parser output must be fast, raw JSON only, and free of reasoning prose.
- No multi-agent backend chain.
- Telegram drift alerts are the current retention infrastructure.
- Delta Share Card is a shipped launch surface.
- Brand language may evolve, but math ownership does not.
