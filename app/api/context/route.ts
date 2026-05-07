import { NextResponse } from "next/server";

import { ingestDashboardPayload } from "@/lib/full-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30_000;
let cache: { key: string; payload: unknown; ts: number } | null = null;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const redactPaths = u.searchParams.get("redact") === "1";
  const db = u.searchParams.get("db") ?? undefined;
  const skipCursor = u.searchParams.get("cursor") === "0";
  const skipClaude = u.searchParams.get("claude") === "0";
  const skipCodex = u.searchParams.get("codex") === "0";
  const force = u.searchParams.get("force") === "1";

  const cacheKey = [redactPaths, db ?? "", skipCursor, skipClaude, skipCodex].join("|");
  const now = Date.now();
  if (!force && cache && cache.key === cacheKey && now - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  try {
    const payload = ingestDashboardPayload({
      redactPaths,
      cursorDbPath: db ?? undefined,
      skipCursor,
      skipClaude,
      skipCodex,
    });
    cache = { key: cacheKey, payload, ts: now };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
