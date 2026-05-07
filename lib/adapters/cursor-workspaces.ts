import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import type { UnifiedContextEvent } from "../unified-model.js";

function cursorUserDataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin": return path.join(home, "Library/Application Support/Cursor/User");
    case "win32":  return path.join(process.env.APPDATA ?? home, "Cursor/User");
    default:       return path.join(home, ".config/Cursor/User");
  }
}

function folderLabel(folder: string): string {
  const home = os.homedir();
  return folder.startsWith(home) ? `~${folder.slice(home.length)}` : folder;
}

interface Generation {
  unixMs?: number;
  generationUUID?: string;
  type?: string;
}

/**
 * Scans per-workspace Cursor state DBs for aiService.generations to detect
 * projects where Cursor was used but left no messageRequestContext snapshots.
 * Produces zero-value events (no token data) used only for project attribution.
 */
export function scanCursorWorkspaceGenerations(): UnifiedContextEvent[] {
  const storageDir = path.join(cursorUserDataDir(), "workspaceStorage");
  if (!fs.existsSync(storageDir)) return [];

  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(storageDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }

  const events: UnifiedContextEvent[] = [];

  for (const dir of dirs) {
    const workspaceJson = path.join(storageDir, dir.name, "workspace.json");
    const dbPath = path.join(storageDir, dir.name, "state.vscdb");

    let folder: string;
    try {
      const wj = JSON.parse(fs.readFileSync(workspaceJson, "utf8")) as { folder?: string };
      if (!wj.folder?.startsWith("file://")) continue;
      folder = decodeURIComponent(wj.folder.slice("file://".length));
    } catch {
      continue;
    }

    if (!fs.existsSync(dbPath)) continue;

    let db: InstanceType<typeof Database>;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      continue;
    }

    try {
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key = 'aiService.generations'")
        .get() as { value?: string } | undefined;
      if (!row?.value) continue;

      let generations: Generation[];
      try {
        generations = JSON.parse(row.value) as Generation[];
        if (!Array.isArray(generations) || generations.length === 0) continue;
      } catch {
        continue;
      }

      const latestMs = generations
        .map((g) => g.unixMs ?? 0)
        .reduce((m, t) => (t > m ? t : m), 0);

      events.push({
        agent: "cursor",
        projectLabel: folderLabel(folder),
        conversationId: `workspace-gen:${dir.name}`,
        primaryMeasure: {
          kind: "tokens",
          value: 0,
          note: "Cursor workspace detected via aiService.generations; no token data available.",
        },
        capturedAt: latestMs > 0 ? new Date(latestMs).toISOString() : undefined,
        sourcePath: dbPath,
      });
    } finally {
      db.close();
    }
  }

  return events;
}
