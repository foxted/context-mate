# Vision: context-mate

## Problem

Staying efficient with **context** across AI coding agents is difficult. Cursor, Claude Code, and Codex each hint at pressure differently (bars, limits, token counts), but developers rarely get a clear picture of **what** made a request heavy, which agent is the biggest culprit, or how their habits drift over time. Attachment creep (folders, rules, summarized threads, knowledge items, web refs, large `gitStatusRaw` blobs) is easy to accumulate and hard to audit.

## Thesis

Each agent leaves a local trace of what it sent to the model:

- **Cursor** persists serialized snapshots of message context under keys like `messageRequestContext:*` inside `state.vscdb` (`cursorDiskKV`). Those payloads vary from tiny to **megabytes**. They are a practical proxy for "how much scaffolding you sent," even though they are **not** exact token meters.
- **Claude Code** writes JSONL transcripts under `~/.claude/projects/**/*.jsonl` that include real token usage per turn.
- **Codex** stores conversation data in a local SQLite database.

**Insight:** if we read and normalize all three stores **locally**, we can turn context discipline from vibes into something you can **see, compare, and improve** — across every agent you use.

## Product north star

Build an **offline-first context pressure dashboard** for developers who use AI coding agents and care about:

- **Lean prompts:** fewer accidental megabyte-class attachments.
- **Privacy:** no upload of chat content to a third party by default; read-only inspection of local files and SQLite.
- **Actionability:** not only totals, but cues about **which buckets** grew (e.g. `knowledgeItems`, `webReferences`, `gitStatusRaw`, `attachedFoldersListDirResults`, `summarizedComposers`).
- **Cross-agent view:** projects and conversations unified across Cursor, Claude Code, and Codex so you can spot which tool is eating the most context.
- **Habit feedback:** trends over time once we add session/date correlation (v1 is snapshot analytics; evolution is a natural v2).

Tagline in one line: **Know what you fed the model, before the model bill reminds you.**

## Principles

1. **Honest scope:** we report **stored context metadata** and serialized size, not guaranteed token counts. Cursor bytes are divided by 4 as a rough token estimate and labeled accordingly.
2. **Stable failure modes:** Cursor's schema is **undocumented**; parsers must be defensive and version notes should say which Cursor era was tested.
3. **Safe defaults:** `redact=1` on the JSON API for sharing reports; no silent exfiltration.
4. **Small core:** a local Next.js app that runs against a copied `state.vscdb*` (or live path) plus Claude Code JSONL transcripts and the Codex SQLite store.

## Today vs next

**Today:** cross-agent dashboard with per-agent summary cards, a unified projects table (with agent badges, conversation counts, last-activity timestamps, and subdirectory merging), and a conversations view with per-agent tabs. Cursor composers expand to show bucket breakdowns and per-snapshot sizes. Claude Code conversations show real token totals and peak-per-turn. Codex surfaces what its SQLite schema allows (best-effort). Ingest also covers Cursor workspace generations. A 30-second server-side cache keeps repeated loads fast; force-refresh is available. JSON export at `/api/context` with `redact`, `db`, and per-agent skip flags.

**Next (directional):**

- Time series and "heavy context events" summaries (if stable timestamps or key patterns allow).
- Diffs between two exported reports ("what changed week over week").
- Optional editor hook or pre-send linter that reuses the same shape heuristics (higher integration cost).
- Team mode: aggregated, **fully redacted** metrics only, never raw payloads by default.

## Success

We succeed if regular users catch **preventable context bloat** early, tighten their workflow, and treat context like any other scarce dev resource: **measured, budgeted, and improved on purpose.**
