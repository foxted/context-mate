"use client";

import type { ComposerSummary } from "@/lib/cursor-scan";
import type { UnifiedConversationRollup, AgentKind, MeasureKind } from "@/lib/unified-model";
import React, { useCallback, useEffect, useMemo, useState } from "react";

interface DashboardPayload {
  unified: {
    generatedAt: string;
    agents: AgentKind[];
    projectRollups: {
      agent: AgentKind;
      projectLabel: string;
      conversationCount: number;
      turnCount: number;
      totalPrimary: number;
      primaryKind: string;
      maxTurn: number;
      lastActivity?: string;
    }[];
    conversationRollups: (UnifiedConversationRollup & { lastActivity?: string; title?: string; model?: string })[];
    notes: string[];
    events?: { length?: number };
  };
  cursor: {
    dbPath: string;
    composers: ComposerSummary[];
  } | null;
  codexMeta: { note: string | null; debug?: { sqlitePath?: string; tables?: string[] } };
  claudeUsageEvents?: number;
}

const PAGE_SIZE_PROJECTS = 20;
const PAGE_SIZE_CONVS = 25;

function Pagination({
  total,
  page,
  pageSize,
  onChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  return (
    <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
      <span>{start}–{end} of {total}</span>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
          className="rounded px-2 py-1 hover:bg-black/30 disabled:opacity-30"
        >
          ←
        </button>
        <span className="px-2 py-1">{page + 1} / {pages}</span>
        <button
          type="button"
          disabled={page >= pages - 1}
          onClick={() => onChange(page + 1)}
          className="rounded px-2 py-1 hover:bg-black/30 disabled:opacity-30"
        >
          →
        </button>
      </div>
    </div>
  );
}

function formatMeasure(kind: string, n: number): string {
  if (kind === "bytes") {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (kind === "tokens") {
    if (n === 0) return "—";
    if (n < 1_000) return `${n} tok`;
    if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K tok`;
    if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M tok`;
    return `${(n / 1_000_000_000).toFixed(2)}B tok`;
  }
  return `${Math.round(n)}`;
}

export function DashboardClient({ apiBase }: { apiBase?: string }) {
  const base = apiBase ?? "";
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState<AgentKind | "all">("all");
  const [projectQuery, setProjectQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [convTab, setConvTab] = useState<AgentKind>("cursor");
  const [projectPage, setProjectPage] = useState(0);
  const [convPage, setConvPage] = useState(0);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setErr(null);
    try {
      const url = force ? `${base}/api/context?force=1` : `${base}/api/context`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(
          typeof (b as { error?: unknown }).error === "string"
            ? (b as { error: string }).error
            : r.statusText,
        );
      }
      const js = (await r.json()) as DashboardPayload;
      setData(js);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const projectRows = useMemo(() => {
    setProjectPage(0);
    if (!data) return [];
    let rows = [...data.unified.projectRollups];
    if (agentFilter !== "all") rows = rows.filter((r) => r.agent === agentFilter);
    if (projectQuery.trim())
      rows = rows.filter((r) =>
        r.projectLabel.toLowerCase().includes(projectQuery.toLowerCase()),
      );

    type AgentStat = { agent: AgentKind; total: number; primaryKind: string };
    type Merged = {
      projectLabel: string;
      agents: AgentStat[];
      conversationCount: number;
      turnCount: number;
      lastActivity?: string;
    };
    const byLabel = new Map<string, Merged>();
    for (const pr of rows) {
      let m = byLabel.get(pr.projectLabel);
      if (!m) {
        m = { projectLabel: pr.projectLabel, agents: [], conversationCount: 0, turnCount: 0 };
        byLabel.set(pr.projectLabel, m);
      }
      m.agents.push({ agent: pr.agent, total: pr.totalPrimary, primaryKind: pr.primaryKind });
      m.conversationCount += pr.conversationCount;
      m.turnCount += pr.turnCount;
      if (pr.lastActivity && (!m.lastActivity || pr.lastActivity > m.lastActivity)) {
        m.lastActivity = pr.lastActivity;
      }
    }

    // Merge subdirectories into their deepest known parent (handles worktrees,
    // scripts dirs, and UUID paths decoded with slashes instead of hyphens).
    const deepestFirst = [...byLabel.keys()].sort((a, b) => b.length - a.length);
    for (const child of deepestFirst) {
      if (!byLabel.has(child)) continue;
      let bestParent: string | null = null;
      for (const candidate of byLabel.keys()) {
        if (candidate !== child && child.startsWith(candidate + "/")) {
          if (!bestParent || candidate.length > bestParent.length) bestParent = candidate;
        }
      }
      if (bestParent) {
        const p = byLabel.get(bestParent)!;
        const c = byLabel.get(child)!;
        for (const ag of c.agents) {
          const existing = p.agents.find((a) => a.agent === ag.agent);
          if (existing) existing.total += ag.total;
          else p.agents.push({ ...ag });
        }
        p.conversationCount += c.conversationCount;
        p.turnCount += c.turnCount;
        if (c.lastActivity && (!p.lastActivity || c.lastActivity > p.lastActivity)) {
          p.lastActivity = c.lastActivity;
        }
        byLabel.delete(child);
      }
    }

    return [...byLabel.values()].sort((a, b) => {
      if (a.lastActivity && b.lastActivity) return b.lastActivity > a.lastActivity ? 1 : -1;
      if (a.lastActivity) return -1;
      if (b.lastActivity) return 1;
      return 0;
    });
  }, [data, agentFilter, projectQuery]);

  const totalsByAgent = useMemo(() => {
    if (!data) return [];
    const m = new Map<AgentKind, { conv: number; turns: number; sum: number; kind: string }>();
    for (const pr of data.unified.projectRollups) {
      const cur = m.get(pr.agent);
      const next = cur ?? {
        conv: 0,
        turns: 0,
        sum: 0,
        kind: pr.primaryKind,
      };
      next.conv += pr.conversationCount;
      next.turns += pr.turnCount;
      next.sum += pr.totalPrimary;
      m.set(pr.agent, next);
    }
    return Array.from(m.entries(), ([agent, v]) => ({ agent, ...v }));
  }, [data]);

  const toggleComposer = useCallback((id: string) => {
    setExpanded((x) => (x === id ? null : id));
  }, []);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-col gap-2 border-b border-[var(--border)] pb-8">
        <p className="text-sm text-[var(--muted)]">
          Local Next.js · read-only ingestion · no upload
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Cross-agent{" "}
          <span className="text-[var(--accent)]">context pressure</span>
        </h1>
        <p className="max-w-prose text-[var(--muted)]">
          Review how context built up across agents and projects—then adjust your
          strategy in future conversations. Read-only local data; nothing is
          uploaded by default.
        </p>
        <p className="max-w-prose text-sm text-[var(--muted)]">
          Cursor token counts are estimated (snapshot bytes ÷ 4). Claude Code
          and Codex report real token counts.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={() => load(true)}
            className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm hover:border-[var(--accent2)] disabled:opacity-50"
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </header>

      {loading && (
        <p className="text-[var(--muted)]">Reading local transcripts & DB…</p>
      )}
      {err && (
        <div className="rounded-xl border border-red-500/50 bg-red-950/40 p-4 text-red-100">
          {err}
        </div>
      )}

      {!data && !loading && !err && (
        <p className="text-[var(--muted)]">No data.</p>
      )}

      {data && (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            {(["cursor", "claude-code", "codex"] as const).map((agent) => {
              const meta = totalsByAgent.find((t) => t.agent === agent);
              return (
                <div
                  key={agent}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-lg shadow-black/30"
                >
                  <div className="text-xs uppercase tracking-wider text-[var(--muted)]">
                    {agent}
                  </div>
                  {!meta ? (
                    <div className="mt-4 text-[var(--muted)]">No rows</div>
                  ) : (
                    <>
                      <div className="mt-4 text-lg font-semibold">
                        {formatMeasure(meta.kind, meta.sum)}
                      </div>
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        {meta.conv} conversations · {meta.turns} rows
                      </p>
                      {agent === "cursor" && data.cursor?.dbPath && (
                        <p className="mt-3 truncate text-[10px] text-[var(--muted)]">
                          DB: {data.cursor.dbPath}
                        </p>
                      )}
                      {agent === "claude-code" &&
                        typeof data.claudeUsageEvents === "number" && (
                          <p className="mt-3 text-[10px] text-[var(--muted)]">
                            Usage lines: {data.claudeUsageEvents}
                          </p>
                        )}
                    </>
                  )}
                </div>
              );
            })}
          </section>

          {data.codexMeta.note && (
            <aside className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-sm text-amber-50">
              <strong>Codex</strong>: {data.codexMeta.note}
              {data.codexMeta.debug?.tables && (
                <pre className="mt-3 max-h-48 overflow-auto text-[10px] opacity-70">
                  {data.codexMeta.debug.sqlitePath ?? ""}
                  {"\n"}
                  Tables:{" "}
                  {data.codexMeta.debug.tables.join(", ") ||
                    "(none discovered)"}
                </pre>
              )}
            </aside>
          )}

          <aside className="rounded-xl border border-[var(--border)] bg-black/25 p-4 text-xs leading-relaxed text-[var(--muted)]">
            <p className="font-semibold text-[var(--text)]">Footnotes</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {data.unified.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="mt-3 opacity-75">
              Generated {new Date(data.unified.generatedAt).toLocaleString()}
            </p>
          </aside>

          <section className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0.5">
              {(["all", "cursor", "claude-code", "codex"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAgentFilter(a)}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    agentFilter === a
                      ? "bg-[var(--accent)]/15 text-[var(--accent)] font-medium"
                      : "text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {a === "all" ? "All" : a === "claude-code" ? "Claude Code" : a === "cursor" ? "Cursor" : "Codex"}
                </button>
              ))}
            </div>
            <input
              className="flex-1 min-w-[12rem] rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--muted)]/60"
              placeholder="Filter by project…"
              value={projectQuery}
              onChange={(e) => setProjectQuery(e.target.value)}
            />
          </section>

          <section>
            <h2 className="mb-4 text-xl font-medium">Projects</h2>
            <div className="overflow-auto rounded-xl border border-[var(--border)] bg-[var(--panel)]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-black/35 text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-2">Project</th>
                    <th className="px-4 py-2">Agents</th>
                    <th className="px-4 py-2">Last active</th>
                    <th className="px-4 py-2 text-right">Conversations</th>
                    <th className="px-4 py-2 text-right">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {projectRows.slice(projectPage * PAGE_SIZE_PROJECTS, (projectPage + 1) * PAGE_SIZE_PROJECTS).map((pr) => (
                    <tr key={pr.projectLabel} className="odd:bg-black/25">
                      <td className="max-w-xs truncate px-4 py-2 text-sm">
                        {pr.projectLabel}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {pr.agents.map((a) => (
                            <span
                              key={a.agent}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                background:
                                  a.agent === "cursor" ? "rgba(99,102,241,0.2)" :
                                  a.agent === "claude-code" ? "rgba(110,231,183,0.15)" :
                                  "rgba(125,211,252,0.15)",
                                color:
                                  a.agent === "cursor" ? "#a5b4fc" :
                                  a.agent === "claude-code" ? "#6ee7b7" :
                                  "#7dd3fc",
                              }}
                            >
                              {a.agent === "cursor" ? "cursor" : a.agent === "claude-code" ? "claude" : "codex"}
                              <span className="opacity-70">{formatMeasure(a.primaryKind, a.total)}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-[var(--muted)]">
                        {pr.lastActivity
                          ? new Date(pr.lastActivity).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-sm">
                        {pr.conversationCount}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-sm">
                        {pr.turnCount}
                      </td>
                    </tr>
                  ))}
                  {projectRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-[var(--muted)]">
                        No projects match filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <Pagination total={projectRows.length} page={projectPage} pageSize={PAGE_SIZE_PROJECTS} onChange={setProjectPage} />
            </div>
          </section>

          {(() => {
            const hasCursor = !!data.cursor?.composers?.length;
            const hasClaude = data.unified.conversationRollups.some((c) => c.agent === "claude-code");
            const hasCodex = data.unified.conversationRollups.some((c) => c.agent === "codex");
            const tabs = ([hasCursor && "cursor", hasClaude && "claude-code", hasCodex && "codex"] as const)
              .filter(Boolean) as AgentKind[];
            if (!tabs.length) return null;
            const active = tabs.includes(convTab) ? convTab : tabs[0]!;

            // Build the rows for the active tab
            let rows: { id: string; title?: string; project: string; lastActivity?: string; turns?: number; total: number; totalKind: string; peak: number; extra?: React.ReactNode }[] = [];
            if (active === "cursor" && data.cursor?.composers) {
              rows = data.cursor.composers.map((c) => ({
                id: c.composerId,
                title: c.title ?? undefined,
                project: c.projectLabelRedacted,
                lastActivity: undefined,
                turns: c.snapshotCount,
                total: Math.round(c.totalBytes / 4),
                totalKind: "tokens",
                peak: Math.round(c.maxBytes / 4),
                extra: (
                  <div className="space-y-3">
                    {c.topBuckets.length > 0 && (
                      <div>
                        <p className="mb-1 text-[var(--muted)]">Context buckets</p>
                        <ul className="grid gap-1 font-mono sm:grid-cols-2">
                          {c.topBuckets.slice(0, 12).map((t) => (
                            <li key={t.bucket} className="flex justify-between gap-6">
                              <span className="truncate">{t.bucket}</span>
                              <span className="tabular-nums text-[var(--accent2)]">{formatMeasure("tokens", Math.round(t.bytes / 4))}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <p className="mb-1 text-[var(--muted)]">Snapshots</p>
                      <ul className="max-h-56 space-y-1 overflow-auto font-mono">
                        {c.snapshots.map((s) => (
                          <li key={s.key} className="flex justify-between gap-4 rounded bg-black/40 px-2 py-1">
                            <span className="truncate text-[var(--muted)]">{s.bubbleId}</span>
                            <span className="shrink-0 tabular-nums">{formatMeasure("tokens", Math.round(s.bytes / 4))}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ),
              }));
            } else {
              const convs = data.unified.conversationRollups.filter((c) => c.agent === active);
              rows = convs.map((c) => ({
                id: c.conversationId,
                title: c.title,
                project: c.projectLabel,
                lastActivity: c.lastActivity,
                turns: active === "claude-code" ? c.turnCount : undefined,
                total: c.totalPrimary,
                totalKind: c.primaryKind,
                peak: c.maxTurn,
                extra: (
                  <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[var(--muted)]">
                    <span>{c.conversationId}</span>
                    {c.model && <span>{c.model}</span>}
                    {c.maxTurn > 0 && <span>peak {formatMeasure(c.primaryKind, c.maxTurn)} / turn</span>}
                  </div>
                ),
              }));
            }

            const paged = rows.slice(convPage * PAGE_SIZE_CONVS, (convPage + 1) * PAGE_SIZE_CONVS);

            return (
              <section>
                <div className="mb-4 flex items-center gap-4">
                  <h2 className="text-xl font-medium">Conversations</h2>
                  <div className="flex rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0.5">
                    {tabs.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setConvTab(t); setExpanded(null); setConvPage(0); }}
                        className={`rounded-md px-3 py-1 text-sm transition-colors ${
                          active === t
                            ? "bg-[var(--accent)]/15 text-[var(--accent)] font-medium"
                            : "text-[var(--muted)] hover:text-[var(--text)]"
                        }`}
                      >
                        {t === "cursor" ? "Cursor" : t === "claude-code" ? "Claude Code" : "Codex"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-auto rounded-xl border border-[var(--border)] bg-[var(--panel)]">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-black/35 text-[var(--muted)]">
                      <tr>
                        <th className="px-4 py-2">Title</th>
                        <th className="px-4 py-2">Project</th>
                        <th className="px-4 py-2">Last active</th>
                        {active !== "codex" && <th className="px-4 py-2 text-right">Turns</th>}
                        <th className="px-4 py-2 text-right">Total</th>
                        <th className="px-4 py-2 text-right">Peak / turn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map((row) => {
                        const open = expanded === row.id;
                        return (
                          <React.Fragment key={row.id}>
                            <tr
                              className={`cursor-pointer odd:bg-black/25 hover:bg-black/40 ${open ? "bg-black/40" : ""}`}
                              onClick={() => toggleComposer(row.id)}
                            >
                              <td className="max-w-xs truncate px-4 py-2 font-medium">
                                {row.title ?? <span className="font-mono text-xs text-[var(--muted)]">{row.id.slice(0, 16)}…</span>}
                              </td>
                              <td className="max-w-[12rem] truncate px-4 py-2 text-[var(--muted)]">{row.project}</td>
                              <td className="whitespace-nowrap px-4 py-2 text-xs text-[var(--muted)]">
                                {row.lastActivity ? new Date(row.lastActivity).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"}
                              </td>
                              {active !== "codex" && (
                                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                                  {row.turns ?? "—"}
                                </td>
                              )}
                              <td className="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums">
                                {formatMeasure(row.totalKind, row.total)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                                {formatMeasure(row.totalKind, row.peak)}
                              </td>
                            </tr>
                            {open && (
                              <tr className="bg-black/30">
                                <td colSpan={active === "codex" ? 5 : 6} className="px-5 py-3 text-xs">
                                  {row.extra}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={active === "codex" ? 5 : 6} className="px-4 py-6 text-[var(--muted)]">
                            No conversations.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <Pagination total={rows.length} page={convPage} pageSize={PAGE_SIZE_CONVS} onChange={setConvPage} />
                </div>
              </section>
            );
          })()}
        </>
      )}
    </div>
  );
}
