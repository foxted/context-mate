import Database from "better-sqlite3";
import { parseMessageRequestContextKey } from "./parse-context-key.js";
import {
  extractLayoutAbsPath,
  extractLayoutRootNames,
  resolveProjectAttribution,
  type ProjectAttribution,
} from "./project-attribution.js";
import {
  redactPathsInJsonString,
  summarizeJsonPayload,
  summarizeParsedRecord,
  type PayloadSummary,
} from "./summarize-payload.js";

export interface ContextRow {
  key: string;
  bytes: number;
  summary: PayloadSummary | null;
  parseError: boolean;
  /** Joined bubble `lastTerminalCwd` + layout hints + optional .git ancestor walk. */
  project: ProjectAttribution | null;
}

function valueToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

function parseLastTerminalCwdFromBubbleJson(blob: string): string | null {
  try {
    const o = JSON.parse(blob) as { lastTerminalCwd?: unknown };
    const c = o.lastTerminalCwd;
    return typeof c === "string" && c.length ? c.trim() : null;
  } catch {
    return null;
  }
}

function attachBubbleTerminalCwds(
  rows: RowInternal[],
  db: InstanceType<typeof Database>,
): void {
  type Pending = { bubbleKey: string; rowIndexes: number[] };
  const byBubble = new Map<string, Pending>();
  rows.forEach((row, idx) => {
    const ids = parseMessageRequestContextKey(row.key);
    if (
      !ids ||
      ids.bubbleId === "WARM_SUBMIT" ||
      ids.bubbleId.length < 10
    ) {
      return;
    }
    const bubbleKey = `bubbleId:${ids.composerId}:${ids.bubbleId}`;
    let p = byBubble.get(bubbleKey);
    if (!p) {
      p = {
        bubbleKey,
        rowIndexes: [],
      };
      byBubble.set(bubbleKey, p);
    }
    p.rowIndexes.push(idx);
  });

  const stmt = db.prepare(
    "SELECT value FROM cursorDiskKV WHERE key = ?",
  );

  for (const bk of byBubble.keys()) {
    const pending = byBubble.get(bk)!;
    const rawRow = stmt.get(bk) as { value?: unknown } | undefined;
    if (rawRow === undefined) continue;
    const blob = valueToString(rawRow.value);
    if (!blob) continue;
    const cwd = parseLastTerminalCwdFromBubbleJson(blob);
    for (const ri of pending.rowIndexes) {
      rows[ri]._terminalCwd = cwd;
      rows[ri]._bubbleHit = true;
    }
  }
}

/** Mutation scratch; stripped before exposing rows. */
type RowInternal = ContextRow & {
  _terminalCwd?: string | null;
  _layoutRoots?: string[];
  _layoutAbsPath?: string | null;
  _bubbleHit?: boolean;
};

function finalizeProjects(rows: RowInternal[]): void {
  for (const row of rows) {
    const layoutRoots = row._layoutRoots ?? [];
    // Prefer bubble terminal CWD; fall back to absPath from projectLayouts
    const cwd = row._terminalCwd ?? row._layoutAbsPath ?? undefined;
    const bubbleHit = row._bubbleHit ?? false;
    delete row._terminalCwd;
    delete row._layoutRoots;
    delete row._layoutAbsPath;
    delete row._bubbleHit;
    row.project = resolveProjectAttribution({
      lastTerminalCwd: cwd,
      layoutRoots,
      bubbleMatched: bubbleHit,
    });
  }
}

export function loadContextRows(
  dbPath: string,
  options: { redactPaths: boolean },
): ContextRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const stmt = db.prepare(
      `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'messageRequestContext:%'`,
    );
    const out: RowInternal[] = [];
    for (const row of stmt.iterate() as Iterable<{ key: string; value: unknown }>) {
      const rawOriginal = valueToString(row.value);
      let raw = rawOriginal;
      if (options.redactPaths) {
        raw = redactPathsInJsonString(raw);
      }
      const bytes = Buffer.byteLength(raw, "utf8");
      let summary: PayloadSummary | null = null;
      let layoutRoots: string[] = [];
      let layoutAbsPath: string | null = null;
      try {
        const parsedOriginal = JSON.parse(rawOriginal) as unknown;
        if (
          parsedOriginal !== null &&
          typeof parsedOriginal === "object" &&
          !Array.isArray(parsedOriginal)
        ) {
          const parsedRecord = parsedOriginal as Record<string, unknown>;
          summary = summarizeParsedRecord(parsedRecord);
          layoutRoots = extractLayoutRootNames(parsedRecord);
          layoutAbsPath = extractLayoutAbsPath(parsedRecord);
        }
      } catch {
        summary = null;
      }
      if (options.redactPaths && summary === null) {
        summary = summarizeJsonPayload(raw);
      }
      const rec: RowInternal = {
        key: row.key,
        bytes,
        summary,
        parseError: summary === null && raw.length > 0,
        project: null,
      };
      rec._layoutRoots = layoutRoots;
      rec._layoutAbsPath = layoutAbsPath;
      out.push(rec);
    }

    attachBubbleTerminalCwds(out, db);
    finalizeProjects(out);
    return out as ContextRow[];
  } finally {
    db.close();
  }
}

export interface HistogramBucket {
  label: string;
  count: number;
}

export function buildHistogram(rows: ContextRow[]): HistogramBucket[] {
  const bounds = [
    { max: 1024, label: "0 to 1 KB" },
    { max: 10 * 1024, label: "1 KB to 10 KB" },
    { max: 100 * 1024, label: "10 KB to 100 KB" },
    { max: 1024 * 1024, label: "100 KB to 1 MB" },
    { max: Infinity, label: "1 MB+" },
  ] as const;
  const counts = bounds.map(() => 0);
  for (const r of rows) {
    let i = 0;
    while (i < bounds.length - 1 && r.bytes >= bounds[i].max) i += 1;
    counts[i] += 1;
  }
  return bounds.map((b, i) => ({ label: b.label, count: counts[i] }));
}

export function percentile(sortedBytes: number[], p: number): number {
  if (sortedBytes.length === 0) return 0;
  const idx = Math.min(
    sortedBytes.length - 1,
    Math.floor((p / 100) * (sortedBytes.length - 1)),
  );
  return sortedBytes[idx];
}
