import fs from "node:fs";
import os from "node:os";
import path from "node:path";


import Database from "better-sqlite3";

import type { UnifiedContextEvent } from "../unified-model.js";

export interface CodexScanResult {
  events: UnifiedContextEvent[];
  note: string | null;
  debug?: { sqlitePath?: string; tables?: string[] };
}

function codexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

function guessSqlitePath(): string | null {
  const home = codexHome();

  /** Prefer state_N.sqlite (has threads + tokens_used) over logs_N.sqlite */
  try {
    const entries = fs.readdirSync(home, { withFileTypes: true });
    // Pick highest-numbered state_N.sqlite
    const stateFiles = entries
      .filter((e) => e.isFile() && /^state_\d+\.sqlite$/.test(e.name))
      .sort((a, b) => {
        const nA = parseInt(a.name.replace(/\D/g, ""), 10);
        const nB = parseInt(b.name.replace(/\D/g, ""), 10);
        return nB - nA;
      });
    if (stateFiles.length > 0) return path.join(home, stateFiles[0]!.name);

    // Legacy: any other *.sqlite (older Codex builds)
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (
        (e.name.endsWith(".sqlite") || e.name.endsWith(".sqlite3")) &&
        !e.name.startsWith("logs_")
      ) {
        return path.join(home, e.name);
      }
    }
  } catch {
    /* no home */
  }
  return null;
}

function safeListTables(db: InstanceType<typeof Database>): string[] {
  try {
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}

/**
 * Best-effort Codex ingestion. Schema is unpublished and version-specific; returns empty events + explanatory note when unknown.
 */
export function scanCodexStore(): CodexScanResult {
  const sqlitePath = guessSqlitePath();
  if (!sqlitePath || !fs.existsSync(sqlitePath)) {
    return {
      events: [],
      note: `No Codex SQLite found under ${codexHome()}. Install/run Codex CLI or set CODEX_HOME/CODEX_SQLITE_HOME.`,
    };
  }

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      events: [],
      note: `Codex SQLite exists but failed to open (${msg}).`,
      debug: { sqlitePath },
    };
  }

  try {
    const tables = safeListTables(db);
    const lowered = new Set(tables.map((t) => t.toLowerCase()));
    const events: UnifiedContextEvent[] = [];

    if (lowered.has("threads")) {
      try {
        const rows = db
          .prepare(
            `SELECT id, cwd, tokens_used, created_at, created_at_ms, title, first_user_message, model
             FROM threads
             WHERE tokens_used > 0`,
          )
          .all() as Record<string, unknown>[];
        for (const r of rows) {
          const tokens =
            typeof r.tokens_used === "number" ? r.tokens_used : Number(r.tokens_used) || 0;
          if (tokens <= 0) continue;
          const rawCwd = typeof r.cwd === "string" && r.cwd.length > 0 ? r.cwd : "unknown-project";
          const home = os.homedir();
          const cwd = rawCwd.startsWith(home) ? `~${rawCwd.slice(home.length)}` : rawCwd;
          const tsMs =
            typeof r.created_at_ms === "number" && r.created_at_ms > 0
              ? r.created_at_ms
              : typeof r.created_at === "number" && r.created_at > 0
                ? r.created_at * 1000
                : null;
          const title =
            typeof r.title === "string" && r.title.length > 0
              ? r.title
              : typeof r.first_user_message === "string" && r.first_user_message.length > 0
                ? r.first_user_message.slice(0, 200)
                : undefined;

          events.push({
            agent: "codex",
            projectLabel: cwd,
            conversationId: String(r.id ?? "thread"),
            primaryMeasure: {
              kind: "tokens",
              value: tokens,
              note: "Cumulative tokens_used from Codex state DB threads table.",
            },
            capturedAt: tsMs ? new Date(tsMs).toISOString() : undefined,
            sourcePath: sqlitePath,
            title,
            model: typeof r.model === "string" && r.model.length > 0 ? r.model : undefined,
          });
        }
      } catch {
        /* fallthrough */
      }
    }

    if (events.length > 0) {
      return { events, note: null, debug: { sqlitePath, tables } };
    }

    return {
      events: [],
      note: `Codex SQLite opened but no compatible usage tables found. Tables: ${tables.join(", ") || "(none)"}.`,
      debug: { sqlitePath, tables },
    };
  } finally {
    db.close();
  }
}
