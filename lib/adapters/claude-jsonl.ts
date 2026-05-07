import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { UnifiedContextEvent } from "../unified-model.js";

export interface ClaudeScanOptions {
  /** Default: ~/.claude/projects */
  projectsRoot?: string;
  /** Max transcript files to scan (newest first by mtime) */
  maxFiles?: number;
}

function defaultProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

function walkJsonlFiles(root: string, maxFiles: number): string[] {
  const out: { p: string; m: number }[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        try {
          const st = fs.statSync(full);
          out.push({ p: full, m: st.mtimeMs });
        } catch {
          /* skip */
        }
      }
    }
  }

  if (fs.existsSync(root)) walk(root);
  out.sort((a, b) => b.m - a.m);
  return out.slice(0, maxFiles).map((x) => x.p);
}

function projectLabelFromPath(filePath: string, projectsRoot: string): string {
  const rel = path.relative(projectsRoot, path.dirname(filePath));
  if (rel.length === 0 || rel.startsWith("..")) return path.dirname(filePath);
  // Claude CLI encodes project paths as folder names by replacing every "/" with "-"
  // and prepending a "-" for the leading "/". Best-effort decode, then tilde-shorten.
  const decoded = rel.startsWith("-") ? rel.replace(/-/g, "/") : rel;
  const home = os.homedir();
  return decoded.startsWith(home) ? `~${decoded.slice(home.length)}` : decoded;
}

interface UsageBlob {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
}

function coerceUsage(obj: UsageBlob): {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  totalWeighted: number;
} {
  const n = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;

  const input = n(obj.input_tokens);
  const output = n(obj.output_tokens);
  const cacheCreate = n(obj.cache_creation_input_tokens);
  const cacheRead = n(obj.cache_read_input_tokens);
  const totalWeighted = input + cacheCreate + cacheRead + output * 0;
  return { input, output, cacheCreate, cacheRead, totalWeighted };
}

/** Best-effort: sum fields that correlate with prompt/context pressure from transcript usage blocks. */
function usageFromRecord(record: Record<string, unknown>): UsageBlob | null {
  // Current Claude Code format: { message: { usage: {...} } }
  const msg = record.message;
  if (msg && typeof msg === "object" && !Array.isArray(msg)) {
    const u = (msg as Record<string, unknown>).usage;
    if (u && typeof u === "object" && !Array.isArray(u)) return u as UsageBlob;
  }
  // Older / alternate format: { usage: {...} }
  const u = record.usage;
  if (!u || typeof u !== "object" || Array.isArray(u)) return null;
  return u as UsageBlob;
}

/**
 * Parses Claude Code local transcript JSONLs into unified events (one row per transcript line carrying `usage`).
 * Token fields vary by Claude Code version — parser is defensive.
 */
export function scanClaudeJsonlTranscripts(
  options: ClaudeScanOptions = {},
): UnifiedContextEvent[] {
  const root = options.projectsRoot ?? defaultProjectsRoot();
  const maxFiles = options.maxFiles ?? 400;
  const files = walkJsonlFiles(root, maxFiles);
  const events: UnifiedContextEvent[] = [];

  for (const file of files) {
    const proj = projectLabelFromPath(file, root);
    const convId = path.basename(file, ".jsonl");

    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const lines = raw.split("\n");
    let lineIdx = 0;
    let firstUserMessage: string | undefined;
    let firstModel: string | undefined;

    for (const line of lines) {
      lineIdx += 1;
      const trimmed = line.trim();
      if (!trimmed) continue;

      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }

      // Capture first user message as conversation title
      if (!firstUserMessage) {
        const msg = rec.message && typeof rec.message === "object" ? rec.message as Record<string, unknown> : rec;
        if (msg.role === "user") {
          const content = msg.content;
          if (typeof content === "string") {
            firstUserMessage = content.trim().slice(0, 200);
          } else if (Array.isArray(content)) {
            const textPart = content.find(
              (c): c is Record<string, unknown> => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text",
            );
            if (textPart && typeof textPart.text === "string") {
              firstUserMessage = textPart.text.trim().slice(0, 200);
            }
          }
        }
      }

      const u = usageFromRecord(rec);
      if (!u) continue;

      const m = coerceUsage(u);
      if (m.input === 0 && m.cacheCreate === 0 && m.cacheRead === 0 && m.output === 0)
        continue;

      // Capture model from the assistant message
      if (!firstModel) {
        const msg = rec.message && typeof rec.message === "object" ? rec.message as Record<string, unknown> : null;
        if (msg && typeof msg.model === "string") firstModel = msg.model;
      }

      const capturedAt =
        typeof rec.timestamp === "string"
          ? rec.timestamp
          : typeof rec.created_at === "string"
            ? rec.created_at
            : undefined;

      const turnHint =
        (typeof rec.uuid === "string" && rec.uuid) ||
        (typeof rec.id === "string" && rec.id) ||
        `line:${lineIdx}`;

      events.push({
        agent: "claude-code",
        projectLabel: proj.replace(/\\/g, "/"),
        conversationId: convId,
        turnId: turnHint.slice(0, 80),
        primaryMeasure: {
          kind: "tokens",
          value: Math.round(m.totalWeighted || m.input + m.cacheCreate + m.cacheRead),
          note: `input_tokens ${m.input}; cache_creation ${m.cacheCreate}; cache_read ${m.cacheRead}; output_tokens ${m.output} (weighted sum for ranking).`,
        },
        capturedAt,
        sourcePath: file,
        title: firstUserMessage,
        model: firstModel,
      });
    }
  }

  return events;
}
