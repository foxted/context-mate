# Contributing to context-mate

## Running locally

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. The app reads local files only — no network calls are made.

## Project layout

```
app/          Next.js app router (page, dashboard client, API route)
lib/          Ingestion logic
  adapters/   Per-agent readers (cursor-workspaces, claude-jsonl, codex)
  cursor-scan.ts       Cursor state.vscdb parser
  full-ingest.ts       Orchestrates all adapters into a unified payload
  unified-model.ts     Shared TypeScript types
```

## Making changes

- Keep adapters defensive — Cursor's schema is undocumented and changes between releases.
- Don't add dependencies lightly; the goal is a small, self-contained local tool.
- Run `pnpm build` before opening a PR to catch type errors.

## Reporting issues

Open a GitHub issue with:
- Your Cursor version (if relevant)
- OS
- The error message or unexpected behavior
- A redacted JSON export if useful: `curl -s 'http://localhost:3000/api/context?redact=1' -o report.json`

## Pull requests

PRs are welcome. For anything beyond a small fix, open an issue first to discuss the approach.
