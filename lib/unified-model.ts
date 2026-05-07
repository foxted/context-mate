/** Cross-agent normalized context pressure (best-effort; metrics are not comparable across agents). */

export type AgentKind = "cursor" | "claude-code" | "codex";

export type MeasureKind = "bytes" | "tokens" | "mixed";

export interface PrimaryMeasure {
  kind: MeasureKind;
  value: number;
  note?: string;
}

export interface UnifiedBreakdownItem {
  name: string;
  bytes?: number;
  tokens?: number;
  meta?: Record<string, string | number | boolean | null>;
}

export interface UnifiedContextEvent {
  agent: AgentKind;
  projectLabel: string;
  conversationId: string;
  turnId?: string;
  primaryMeasure: PrimaryMeasure;
  breakdown?: UnifiedBreakdownItem[];
  capturedAt?: string;
  sourcePath?: string;
  title?: string;
  model?: string;
}

export interface UnifiedProjectRollup {
  agent: AgentKind;
  projectLabel: string;
  conversationCount: number;
  turnCount: number;
  totalPrimary: number;
  primaryKind: MeasureKind;
  maxTurn: number;
  lastActivity?: string;
}

export interface UnifiedConversationRollup {
  agent: AgentKind;
  projectLabel: string;
  conversationId: string;
  turnCount: number;
  totalPrimary: number;
  primaryKind: MeasureKind;
  maxTurn: number;
  lastActivity?: string;
  title?: string;
  model?: string;
}

export interface UnifiedDashboardPayload {
  generatedAt: string;
  agents: AgentKind[];
  events: UnifiedContextEvent[];
  projectRollups: UnifiedProjectRollup[];
  conversationRollups: UnifiedConversationRollup[];
  notes: string[];
}
