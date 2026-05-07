import Database from "better-sqlite3";
import {
  buildHistogram,
  loadContextRows,
  type ContextRow,
  type HistogramBucket,
} from "./analyze.js";
import { explain } from "./explain.js";
import { isWarmSubmitContextKey, parseMessageRequestContextKey } from "./parse-context-key.js";
import {
  displayProjectFolder,
  displayProjectRollupFolder,
  rollupByProject,
  rollupFolderKeyForRow,
  sortedBucketTotals,
  UNKNOWN_PROJECT_KEY,
  type ProjectRollupRow,
  WARM_SUBMIT_PROJECT_KEY,
} from "./project-attribution.js";
import type { Bucket } from "./summarize-payload.js";
import type {
  UnifiedContextEvent,
  UnifiedConversationRollup,
  UnifiedDashboardPayload,
  UnifiedProjectRollup,
} from "./unified-model.js";

export interface CursorScanOptions {
  redactPaths: boolean;
}

export interface ComposerSnapshotSummary {
  key: string;
  bubbleId: string;
  bytes: number;
  parseError: boolean;
  workspaceLabel: string | null;
}

export interface ComposerSummary {
  composerId: string;
  /** Dominant workspace rollup key by bytes among snapshots in this composer. */
  projectFolderKey: string;
  projectLabelRedacted: string;
  snapshots: ComposerSnapshotSummary[];
  snapshotCount: number;
  totalBytes: number;
  maxBytes: number;
  topBuckets: { bucket: string; bytes: number }[];
  title?: string;
}

export interface CursorScanReport {
  dbPath: string;
  rowCount: number;
  histogram: HistogramBucket[];
  projects: ProjectRollupRow[];
  rows: ContextRow[];
  composers: ComposerSummary[];
}

function dominantProjectFolderKey(rows: ContextRow[]): string {
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const k = rollupFolderKeyForRow(r);
    byKey.set(k, (byKey.get(k) ?? 0) + r.bytes);
  }
  let best = UNKNOWN_PROJECT_KEY;
  let max = -1;
  for (const [k, b] of byKey) {
    if (b > max) {
      max = b;
      best = k;
    }
  }
  return best;
}

/** Merge bucket byte totals across snapshots (same bucket name summed). */
function mergeBucketTotals(rows: ContextRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.summary?.buckets) continue;
    for (const b of r.summary.buckets) {
      m.set(b.key, (m.get(b.key) ?? 0) + b.bytes);
    }
  }
  return m;
}

export function summarizeComposers(
  rows: ContextRow[],
  redactPaths: boolean,
): ComposerSummary[] {
  const byComposer = new Map<string, ContextRow[]>();
  for (const row of rows) {
    const ids = parseMessageRequestContextKey(row.key);
    const composerId = ids?.composerId ?? "_unkeyed";
    let list = byComposer.get(composerId);
    if (!list) {
      list = [];
      byComposer.set(composerId, list);
    }
    list.push(row);
  }

  const out: ComposerSummary[] = [];
  for (const [composerId, group] of byComposer) {
    const projectFolderKey = dominantProjectFolderKey(group);
    const topTotals = [...mergeBucketTotals(group).entries()]
      .map(([bucket, bytes]) => ({ bucket, bytes }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 15);

    const snapshots: ComposerSnapshotSummary[] = group.map((r) => {
      const ids = parseMessageRequestContextKey(r.key);
      return {
        key: r.key,
        bubbleId: ids?.bubbleId ?? "?",
        bytes: r.bytes,
        parseError: r.parseError,
        workspaceLabel: displayProjectFolder(r.project ?? undefined, redactPaths),
      };
    });
    snapshots.sort((a, b) => b.bytes - a.bytes);

    const totalBytes = group.reduce((s, r) => s + r.bytes, 0);
    const maxBytes = snapshots.length ? snapshots[0]!.bytes : 0;

    out.push({
      composerId,
      projectFolderKey,
      projectLabelRedacted: displayProjectRollupFolder(
        projectFolderKey,
        redactPaths,
      ),
      snapshots,
      snapshotCount: group.length,
      totalBytes,
      maxBytes,
      topBuckets: topTotals,
    });
  }

  out.sort((a, b) => b.totalBytes - a.totalBytes);
  return out;
}

export function scanCursorStateDb(
  dbPath: string,
  options: CursorScanOptions,
): CursorScanReport {
  const rows = loadContextRows(dbPath, { redactPaths: options.redactPaths });
  const composers = summarizeComposers(rows, options.redactPaths);

  // Attach AI-generated conversation names from composerData entries
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const stmt = db.prepare(
        "SELECT json_extract(value,'$.name') AS name FROM cursorDiskKV WHERE key = ?",
      );
      for (const c of composers) {
        const row = stmt.get(`composerData:${c.composerId}`) as { name?: string } | undefined;
        if (row?.name && typeof row.name === "string" && row.name.trim()) {
          c.title = row.name.trim();
        }
      }
    } finally {
      db.close();
    }
  } catch {
    /* non-critical — titles remain undefined */
  }

  return {
    dbPath,
    rowCount: rows.length,
    histogram: buildHistogram(rows),
    projects: rollupByProject(rows),
    rows,
    composers,
  };
}

export interface JsonScanPayloadOptions extends CursorScanOptions {
  dbPath: string;
}

/** Shape matches prior CLI `--json` output + `composers` for dashboards. */
export function buildCursorJsonPayload(
  report: CursorScanReport,
  redactPaths: boolean,
): Record<string, unknown> {
  const rows = report.rows;
  const projects = report.projects.map((r) => {
    const tops = sortedBucketTotals(r).slice(0, 3);
    const coachLine =
      tops.length === 0
        ? "No attributable buckets in parsed snapshots."
        : tops
            .map(
              (t_) =>
                `${t_.bucket} (${explain(t_.bucket)?.what ?? "see bucket name"})`,
            )
            .slice(0, 2)
            .join("; ");
    return {
      folderPath:
        r.folderKey === UNKNOWN_PROJECT_KEY ||
        r.folderKey === WARM_SUBMIT_PROJECT_KEY
          ? null
          : redactPaths
            ? null
            : r.folderKey,
      folderPathRedacted: displayProjectRollupFolder(r.folderKey, redactPaths),
      snapshotRows: r.rows,
      totalBytes: r.totalBytes,
      topBuckets: sortedBucketTotals(r).slice(0, 15).map((t_) => ({
        bucket: t_.bucket,
        bytes: t_.bytes,
        explanation: explain(t_.bucket) ?? null,
      })),
      coachLine,
    };
  });

  return {
    dbPath: report.dbPath,
    rowCount: report.rowCount,
    histogram: report.histogram,
    projects,
    composers: report.composers,
    rows: rows
      .map((r) => ({
        key: r.key,
        bytes: r.bytes,
        parseError: r.parseError,
        workspaceFolder: redactPaths ? null : (r.project?.folder ?? null),
        workspaceLabel: displayProjectFolder(r.project ?? undefined, redactPaths),
        projectResolution: r.project?.resolvedBy ?? null,
        buckets: r.summary?.buckets.map((b) => ({
          key: b.key,
          bytes: b.bytes,
          kind: b.kind,
          count: b.count,
          items: b.items,
          explanation: explain(b.key) ?? null,
        })),
      }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}

function contextRowToUnifiedEvents(row: ContextRow, redactPaths: boolean): UnifiedContextEvent {
  const ids = parseMessageRequestContextKey(row.key);
  const projectKey = rollupFolderKeyForRow(row);
  const projectLabel = displayProjectRollupFolder(projectKey, redactPaths);

  const breakdown =
    row.summary?.buckets.map((b: Bucket) => ({
      name: b.key,
      bytes: b.bytes,
    })) ?? [];

  return {
    agent: "cursor",
    projectLabel,
    conversationId: ids?.composerId ?? "_unkeyed",
    turnId: ids?.bubbleId,
    primaryMeasure: {
      kind: "tokens",
      value: Math.round(row.bytes / 4),
      note: "Estimated from snapshot byte size ÷ 4 (rough approximation; not comparable to real token counts).",
    },
    breakdown: breakdown.length ? breakdown : undefined,
  };
}

function rollupsFromEvents(events: UnifiedContextEvent[]): {
  projectRollups: UnifiedProjectRollup[];
  conversationRollups: UnifiedConversationRollup[];
} {
  const byProject = new Map<
    string,
    {
      agent: UnifiedProjectRollup["agent"];
      projectLabel: string;
      conversations: Set<string>;
      turns: number;
      totalPrimary: number;
      primaryKind: UnifiedProjectRollup["primaryKind"];
      maxTurn: number;
      lastActivity: string | undefined;
    }
  >();
  const byConv = new Map<
    string,
    {
      agent: UnifiedConversationRollup["agent"];
      projectLabel: string;
      conversationId: string;
      turns: number;
      totalPrimary: number;
      primaryKind: UnifiedConversationRollup["primaryKind"];
      maxTurn: number;
      lastActivity: string | undefined;
      title: string | undefined;
      model: string | undefined;
    }
  >();

  for (const ev of events) {
    const pk = `${ev.agent}:${ev.projectLabel}`;
    let pr = byProject.get(pk);
    if (!pr) {
      pr = {
        agent: ev.agent,
        projectLabel: ev.projectLabel,
        conversations: new Set(),
        turns: 0,
        totalPrimary: 0,
        primaryKind: ev.primaryMeasure.kind,
        maxTurn: 0,
        lastActivity: undefined,
      };
      byProject.set(pk, pr);
    }
    pr.conversations.add(ev.conversationId);
    pr.turns += 1;
    pr.totalPrimary += ev.primaryMeasure.value;
    pr.maxTurn = Math.max(pr.maxTurn, ev.primaryMeasure.value);
    if (ev.capturedAt && (!pr.lastActivity || ev.capturedAt > pr.lastActivity)) {
      pr.lastActivity = ev.capturedAt;
    }

    const ck = `${ev.agent}:${ev.projectLabel}:${ev.conversationId}`;
    let cr = byConv.get(ck);
    if (!cr) {
      cr = {
        agent: ev.agent,
        projectLabel: ev.projectLabel,
        conversationId: ev.conversationId,
        turns: 0,
        totalPrimary: 0,
        primaryKind: ev.primaryMeasure.kind,
        maxTurn: 0,
        lastActivity: undefined,
        title: ev.title,
        model: ev.model,
      };
      byConv.set(ck, cr);
    }
    cr.turns += 1;
    cr.totalPrimary += ev.primaryMeasure.value;
    cr.maxTurn = Math.max(cr.maxTurn, ev.primaryMeasure.value);
    if (ev.capturedAt && (!cr.lastActivity || ev.capturedAt > cr.lastActivity)) {
      cr.lastActivity = ev.capturedAt;
    }
  }

  const projectRollups: UnifiedProjectRollup[] = [...byProject.values()].map(
    (v) => ({
      agent: v.agent,
      projectLabel: v.projectLabel,
      conversationCount: v.conversations.size,
      turnCount: v.turns,
      totalPrimary: v.totalPrimary,
      primaryKind: v.primaryKind,
      maxTurn: v.maxTurn,
      lastActivity: v.lastActivity,
    }),
  );
  projectRollups.sort((a, b) => {
    if (a.lastActivity && b.lastActivity) return b.lastActivity > a.lastActivity ? 1 : -1;
    if (a.lastActivity) return -1;
    if (b.lastActivity) return 1;
    return b.totalPrimary - a.totalPrimary;
  });

  const conversationRollups: UnifiedConversationRollup[] = [
    ...byConv.values(),
  ].map((v) => ({
    agent: v.agent,
    projectLabel: v.projectLabel,
    conversationId: v.conversationId,
    turnCount: v.turns,
    totalPrimary: v.totalPrimary,
    primaryKind: v.primaryKind,
    maxTurn: v.maxTurn,
    lastActivity: v.lastActivity,
    title: v.title,
    model: v.model,
  }));
  conversationRollups.sort((a, b) => {
    if (a.lastActivity && b.lastActivity) return b.lastActivity > a.lastActivity ? 1 : -1;
    if (a.lastActivity) return -1;
    if (b.lastActivity) return 1;
    return b.totalPrimary - a.totalPrimary;
  });

  return { projectRollups, conversationRollups };
}

export function mergeUnifiedDashboard(parts: {
  cursor?: CursorScanReport;
  claudeEvents?: UnifiedContextEvent[];
  codexEvents?: UnifiedContextEvent[];
  cursorWorkspaceEvents?: UnifiedContextEvent[];
  codexNote?: string;
  redactPaths: boolean;
}): UnifiedDashboardPayload {
  const notes: string[] = [
    "Cursor token counts are estimated (snapshot bytes ÷ 4). Claude Code and Codex report real token counts.",
  ];
  if (parts.codexNote) notes.push(parts.codexNote);

  const events: UnifiedContextEvent[] = [];

  if (parts.cursor) {
    for (const row of parts.cursor.rows) {
      if (isWarmSubmitContextKey(row.key)) continue;
      events.push(contextRowToUnifiedEvents(row, parts.redactPaths));
    }
  }
  if (parts.claudeEvents?.length)
    events.push(...parts.claudeEvents);
  if (parts.codexEvents?.length)
    events.push(...parts.codexEvents);
  if (parts.cursorWorkspaceEvents?.length)
    events.push(...parts.cursorWorkspaceEvents);

  const agents = new Set(events.map((e) => e.agent));
  const { projectRollups, conversationRollups } = rollupsFromEvents(events);

  return {
    generatedAt: new Date().toISOString(),
    agents: [...agents],
    events,
    projectRollups,
    conversationRollups,
    notes,
  };
}
