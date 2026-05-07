import fs from "node:fs";
import path from "node:path";

import { parseMessageRequestContextKey } from "./parse-context-key.js";

export interface ProjectAttribution {
  /** Best-effort absolute workspace folder path (POSIX/Win normalized). */
  folder: string;
  /** How we resolved folder (shown in JSON; human report uses concise copy only). */
  resolvedBy: "layout_root_then_cwd" | "git_root_from_terminal_cwd" | "terminal_cwd_only";
  /** Basename(s) derived from Cursor project layout snapshot (often repo name). */
  layoutRoots: string[];
  /** Bubble join failed or warming row */
  composerBubbleKnown: boolean;
}

export interface ProjectRollupRow {
  folderKey: string;
  rows: number;
  totalBytes: number;
  bucketTotals: Map<string, number>;
}

/** Extract `rootPath` basenames from each serialized projectLayouts JSON string. */
export function extractLayoutRootNames(
  record: Record<string, unknown>,
): string[] {
  const pl = record.projectLayouts;
  if (!Array.isArray(pl)) return [];
  const names: string[] = [];
  for (const el of pl) {
    if (typeof el !== "string") continue;
    try {
      const inner = JSON.parse(el) as { rootPath?: unknown };
      if (typeof inner.rootPath === "string" && inner.rootPath.length > 0) {
        names.push(inner.rootPath);
      }
    } catch {
      /* malformed layout chunk */
    }
  }
  return [...new Set(names)];
}

/**
 * Extract the absolute workspace root path from projectLayouts, which stores
 * the full path in listDirV2Result.directoryTreeRoot.absPath. This lets us
 * attribute rows to a project without needing the terminal CWD from the bubble.
 */
export function extractLayoutAbsPath(
  record: Record<string, unknown>,
): string | null {
  const pl = record.projectLayouts;
  if (!Array.isArray(pl)) return null;
  for (const el of pl) {
    if (typeof el !== "string") continue;
    try {
      const inner = JSON.parse(el) as {
        listDirV2Result?: { directoryTreeRoot?: { absPath?: unknown } };
      };
      const ap = inner.listDirV2Result?.directoryTreeRoot?.absPath;
      if (typeof ap === "string" && path.isAbsolute(ap)) return ap;
    } catch {
      /* malformed */
    }
  }
  return null;
}

export function nearestGitAncestor(startDir: string): string | null {
  let cur = path.normalize(startDir.split("\0")[0].trim());
  if (!path.isAbsolute(cur)) return null;
  for (let i = 0; i < 40; i += 1) {
    try {
      const gitMarker = path.join(cur, ".git");
      if (fs.existsSync(gitMarker)) return cur;
    } catch {
      return null;
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

/**
 * Prefer an ancestor folder of `cwd` whose basename matches a layout `rootPath`
 * (Cursor stores a logical name such as repo folder / multi-root leaf).
 */
function folderFromLayoutHints(
  cwd: string,
  layoutRoots: string[],
): string | null {
  const normalized = path.normalize(cwd.split("\0")[0].trim());
  if (!path.isAbsolute(normalized)) return null;
  for (const hint of layoutRoots) {
    if (!hint) continue;
    let cur = normalized;
    for (let i = 0; i < 40; i += 1) {
      const base = path.basename(cur);
      if (base === hint) return cur;
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return null;
}

export function resolveProjectAttribution(opts: {
  lastTerminalCwd: string | null | undefined;
  layoutRoots: string[];
  bubbleMatched: boolean;
}): ProjectAttribution | null {
  const cwd = opts.lastTerminalCwd?.trim();
  if ((!cwd || cwd.length < 2) && opts.layoutRoots.length === 0) {
    return null;
  }

  if (cwd && cwd.length >= 2) {
    const fromLayout = folderFromLayoutHints(cwd, opts.layoutRoots);
    if (fromLayout) {
      return {
        folder: fromLayout,
        resolvedBy: "layout_root_then_cwd",
        layoutRoots: [...opts.layoutRoots],
        composerBubbleKnown: opts.bubbleMatched,
      };
    }
    const git = nearestGitAncestor(cwd);
    if (git) {
      return {
        folder: git,
        resolvedBy: "git_root_from_terminal_cwd",
        layoutRoots: [...opts.layoutRoots],
        composerBubbleKnown: opts.bubbleMatched,
      };
    }
    return {
      folder: path.normalize(cwd.split("\0")[0].trim()),
      resolvedBy: "terminal_cwd_only",
      layoutRoots: [...opts.layoutRoots],
      composerBubbleKnown: opts.bubbleMatched,
    };
  }

  return null;
}

export function formatFolderForDisplay(folder: string, homeDir?: string): string {
  const h = homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (h.length > 0) {
    const norm = folder.replace(/\\/g, "/");
    const homeNorm = path.normalize(h).replace(/\\/g, "/");
    if (norm === homeNorm) return "~";
    const prefix =
      homeNorm.endsWith("/") ? homeNorm : `${homeNorm}/`;
    if (norm.startsWith(prefix)) {
      return `~/${norm.slice(prefix.length)}`;
    }
  }
  return folder;
}

export const UNKNOWN_PROJECT_KEY = "##unknown##";
export const WARM_SUBMIT_PROJECT_KEY = "##warm_submit##";

/** Resolve aggregation key — warm submits are Cursor-internal noise buckets. */
export function rollupFolderKeyForRow(
  row: RowWithProject & { key: string },
): string {
  const ids = parseMessageRequestContextKey(row.key);
  if (ids?.bubbleId === "WARM_SUBMIT") return WARM_SUBMIT_PROJECT_KEY;
  return row.project?.folder ?? UNKNOWN_PROJECT_KEY;
}

function rollupFolderKey(row: RowWithProject & { key: string }): string {
  return rollupFolderKeyForRow(row);
}

export function rollupByProject(
  rows: (RowWithProject & { key: string })[],
): ProjectRollupRow[] {
  const map = new Map<string, ProjectRollupRow>();

  for (const row of rows) {
    const key = rollupFolderKey(row);
    let entry = map.get(key);
    if (!entry) {
      entry = { folderKey: key, rows: 0, totalBytes: 0, bucketTotals: new Map() };
      map.set(key, entry);
    }
    entry.rows += 1;
    entry.totalBytes += row.bytes;
    if (!row.summary?.buckets) continue;
    for (const b of row.summary.buckets) {
      entry.bucketTotals.set(
        b.key,
        (entry.bucketTotals.get(b.key) ?? 0) + b.bytes,
      );
    }
  }

  const list = [...map.values()].sort((a, b) => b.totalBytes - a.totalBytes);
  return list;
}

export interface RowWithProject {
  bytes: number;
  summary: { buckets: { key: string; bytes: number }[] } | null;
  project?: ProjectAttribution | null;
}

export function sortedBucketTotals(
  rollup: ProjectRollupRow,
): { bucket: string; bytes: number }[] {
  return [...rollup.bucketTotals.entries()]
    .map(([bucket, bytes]) => ({ bucket, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
}

export function displayProjectFolder(
  project: ProjectAttribution | null | undefined,
  redactPaths: boolean,
): string | null {
  if (!project) return null;
  return redactPaths
    ? path.basename(project.folder)
    : formatFolderForDisplay(project.folder);
}

export function displayProjectRollupFolder(
  rollupFolderKey: string,
  redactPaths: boolean,
): string {
  if (rollupFolderKey === UNKNOWN_PROJECT_KEY) return "unknown workspace";
  if (rollupFolderKey === WARM_SUBMIT_PROJECT_KEY) {
    return "Cursor warm-up submits (not a workspace)";
  }
  return redactPaths
    ? path.basename(rollupFolderKey)
    : formatFolderForDisplay(rollupFolderKey);
}
