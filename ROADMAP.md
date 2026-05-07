# Vision: context-mate

## Problem

Staying intentional about **context** across AI coding agents is difficult. Cursor, Claude Code, and Codex each hint at pressure differently (bars, limits, token counts), but developers rarely get a **single, comparable history** of what made work heavy, which agent or project drove it, or how patterns shifted over time. Attachment creep (folders, rules, summarized threads, knowledge items, web refs, large `gitStatusRaw` blobs) is easy to accumulate and hard to **look back on** in one place—so it is hard to refine your strategy for the next session.

## Thesis

Each agent leaves a local trace of what it sent to the model:

- **Cursor** persists serialized snapshots of message context under keys like `messageRequestContext:*` inside `state.vscdb` (`cursorDiskKV`). Those payloads vary from tiny to **megabytes**. They are a practical proxy for "how much scaffolding you sent," even though they are **not** exact token meters.
- **Claude Code** writes JSONL transcripts under `~/.claude/projects/**/*.jsonl` that include real token usage per turn.
- **Codex** stores conversation data in a local SQLite database.

**Insight:** if we read and normalize all three stores **locally**, you get a grounded view of **how context use actually played out**—across agents and projects—so reflection is based on evidence, not guessing what “felt” heavy last week.

## Product north star

Build an **offline-first context pressure dashboard** for developers who use AI coding agents and want to **learn from past usage**:

- **Historical clarity:** see **which buckets** dominated (e.g. `knowledgeItems`, `webReferences`, `gitStatusRaw`, `attachedFoldersListDirResults`, `summarizedComposers`) so your next approach is informed, not improvised.
- **Privacy:** no upload of chat content to a third party by default; read-only inspection of local files and SQLite.
- **Cross-agent view:** projects and conversations unified across Cursor, Claude Code, and Codex so you can compare how context showed up per tool—not just in the moment, but as a record you can revisit.
- **Look back, then adjust:** the goal is not to optimize every prompt as you type, but to **notice patterns** and refine how you attach rules, folders, and background state in **future** sessions.
- **Habit feedback:** trends over time once we add session/date correlation (v1 is snapshot analytics; evolution is a natural v2).

Tagline in one line: **See how context built up—then choose what to change next time.**

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
- Optional editor hook or pre-send linter that reuses the same shape heuristics (higher integration cost; **optional**—the core value stays historical insight and comparison, not live gatekeeping).
- Team mode: aggregated, **fully redacted** metrics only, never raw payloads by default.

## Success

We succeed if regular users can **look back** at how context accumulated across agents and projects, **name** what drove the heaviest loads, and **adjust their strategy** in later sessions—with context treated as something you **observe and refine over time**, not only something you react to before the next reply.
