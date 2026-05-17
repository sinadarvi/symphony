export type CodexUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type CodexRuntimeEvent = {
  event: string;
  timestamp: Date;
  sessionId?: string | null;
  threadId?: string | null;
  turnId?: string | null;
  codexAppServerPid?: number | null;
  usage?: CodexUsage;
  rateLimits?: unknown;
  message?: string;
  payload?: unknown;
};

export function normalizeCodexEvent(raw: Record<string, unknown>, ids: { threadId: string | null; turnId: string | null; pid?: number | null }): CodexRuntimeEvent {
  const event = stringValue(raw.event) || stringValue(raw.type) || "other_message";
  const threadId = stringValue(raw.thread_id) || stringValue(raw.threadId) || ids.threadId;
  const turnId = stringValue(raw.turn_id) || stringValue(raw.turnId) || ids.turnId;
  return {
    event,
    timestamp: new Date(),
    threadId,
    turnId,
    sessionId: threadId && turnId ? `${threadId}-${turnId}` : null,
    codexAppServerPid: ids.pid ?? null,
    usage: extractUsage(raw),
    rateLimits: raw.rate_limits ?? raw.rateLimits ?? null,
    message: typeof raw.message === "string" ? raw.message : typeof raw.content === "string" ? raw.content : undefined,
    payload: raw
  };
}

export function isTerminalCodexEvent(event: CodexRuntimeEvent): boolean {
  return ["turn_completed", "turn_failed", "turn_cancelled", "turn_ended_with_error", "turn_input_required"].includes(event.event);
}

function extractUsage(raw: Record<string, unknown>): CodexUsage | undefined {
  const usage = record(raw.usage) ?? record(raw.total_token_usage) ?? record(raw.totalTokenUsage);
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = numberValue(usage.output_tokens ?? usage.outputTokens);
  const totalTokens = numberValue(usage.total_tokens ?? usage.totalTokens);
  if (inputTokens == null && outputTokens == null && totalTokens == null) return undefined;
  return { inputTokens, outputTokens, totalTokens };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
