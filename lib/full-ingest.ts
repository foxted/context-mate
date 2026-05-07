import fs from "node:fs";

import { scanClaudeJsonlTranscripts } from "./adapters/claude-jsonl.js";
import { scanCodexStore, type CodexScanResult } from "./adapters/codex.js";
import { scanCursorWorkspaceGenerations } from "./adapters/cursor-workspaces.js";
import {
  mergeUnifiedDashboard,
  scanCursorStateDb,
  type ComposerSummary,
} from "./cursor-scan.js";
import { defaultCursorStateDbPath } from "./default-db-path.js";
import type { UnifiedDashboardPayload } from "./unified-model.js";

export interface FullIngestOptions {
  redactPaths?: boolean;
  cursorDbPath?: string;
  skipCursor?: boolean;
  skipClaude?: boolean;
  skipCodex?: boolean;
}

export interface DashboardApiPayload {
  unified: UnifiedDashboardPayload;
  cursor?: { dbPath: string; composers: ComposerSummary[] } | null;
  codexMeta: { note: string | null; debug?: CodexScanResult["debug"] };
  claudeUsageEvents?: number;
}

export function ingestDashboardPayload(
  opts: FullIngestOptions = {},
): DashboardApiPayload {
  const redactPaths = opts.redactPaths ?? false;
  let cursorReport: ReturnType<typeof scanCursorStateDb> | undefined;
  let cursorDbPath: string | undefined;
  if (!opts.skipCursor) {
    cursorDbPath = opts.cursorDbPath ?? defaultCursorStateDbPath();
    if (cursorDbPath && fs.existsSync(cursorDbPath)) {
      cursorReport = scanCursorStateDb(cursorDbPath, { redactPaths });
    }
  }

  const claudeEvents = opts.skipClaude
    ? undefined
    : scanClaudeJsonlTranscripts();
  const codex: CodexScanResult = opts.skipCodex
    ? { events: [], note: null }
    : scanCodexStore();
  const cursorWorkspaceEvents = opts.skipCursor
    ? []
    : scanCursorWorkspaceGenerations();

  const unified = mergeUnifiedDashboard({
    cursor: cursorReport,
    claudeEvents,
    codexEvents: codex.events.length ? codex.events : undefined,
    codexNote: codex.note ?? undefined,
    redactPaths,
    cursorWorkspaceEvents: cursorWorkspaceEvents.length ? cursorWorkspaceEvents : undefined,
  });

  return {
    unified,
    cursor:
      cursorDbPath && cursorReport
        ? { dbPath: cursorDbPath, composers: cursorReport.composers }
        : null,
    codexMeta: { note: codex.note, debug: codex.debug },
    claudeUsageEvents: claudeEvents?.length,
  };
}

/** @deprecated use ingestDashboardPayload */
export function ingestUnifiedDashboard(opts: FullIngestOptions = {}) {
  return ingestDashboardPayload(opts).unified;
}
