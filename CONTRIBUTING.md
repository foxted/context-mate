# Contributing to context-mate

Thanks for helping. This project is a **local, read-only** Next.js dashboard: nothing uploads your chats by default.

## Prerequisites

- **Node.js 20+**
- **pnpm** (version in `package.json` → `packageManager`)

## Getting started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The UI loads aggregated data from `/api/context` (same payload as `curl http://localhost:3000/api/context`).

```bash
pnpm build   # production build
pnpm start     # run production server locally
```

## Where the important code lives

| Area | Path | Role |
|------|------|------|
| **HTTP API** | `app/api/context/route.ts` | GET handler, optional in-memory cache (`force=1` bypasses), delegates to ingest. |
| **Full ingest** | `lib/full-ingest.ts` | Orchestrates Cursor DB, Claude JSONL, Codex SQLite, workspace generations; builds the unified payload. |
| **Cursor** | `lib/cursor-scan.ts`, `lib/analyze.ts` | Reads Cursor `state.vscdb` / `cursorDiskKV` snapshots. |
| **Claude Code** | `lib/adapters/claude-jsonl.ts` | Parses `~/.claude/projects/**/*.jsonl` transcripts. |
| **Codex** | `lib/adapters/codex*.ts` (as present) | Best-effort SQLite reads. |
| **Unified model** | `lib/unified-model.ts`, `lib/merge-unified.ts` | Normalizes agents into one dashboard shape. |
| **Dashboard UI** | `app/dashboard-client.tsx` | Tables, filters, composer expansion. |

## Cursor schema caveat

Cursor’s `state.vscdb` layout is **undocumented** and can change between releases. Parsers are defensive; if something breaks after a Cursor update, fixes usually belong in the Cursor-related `lib/` modules above. Prefer copying the DB or using Cursor idle + `db=` query param per [README caveats](./README.md).

## Product intent

The goal is **historical insight**: see how context use played out so you can **adjust strategy** in future sessions—not to police every prompt live. See [ROADMAP.md](./ROADMAP.md).

## Pull requests

- Keep changes focused on the issue or bug.
- Run `pnpm build` before submitting.
- If you add user-facing copy, align it with README / ROADMAP thesis when relevant.

## License

By contributing, you agree your contributions are licensed under the same terms as the project ([MIT](./LICENSE)).
