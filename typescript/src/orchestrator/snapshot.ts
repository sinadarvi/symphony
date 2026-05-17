import type { OrchestratorState } from "./state.js";

export function snapshotState(state: OrchestratorState, now = Date.now()) {
  const activeSeconds = [...state.running.values()].reduce((sum, entry) => sum + Math.max((now - entry.startedAt) / 1000, 0), 0);
  return {
    running: [...state.running.values()].map((entry) => ({
      issue_id: entry.issue.id,
      issue_identifier: entry.issue.identifier,
      status: entry.status,
      turn_count: entry.turnCount ?? 0
    })),
    retrying: [...state.retryAttempts.values()].map((entry) => ({
      issue_id: entry.issueId,
      issue_identifier: entry.identifier,
      attempt: entry.attempt,
      due_at_ms: entry.dueAtMs,
      error: entry.error
    })),
    codex_totals: {
      input_tokens: state.codexTotals.inputTokens,
      output_tokens: state.codexTotals.outputTokens,
      total_tokens: state.codexTotals.totalTokens,
      seconds_running: state.codexTotals.endedRuntimeSeconds + activeSeconds
    },
    rate_limits: state.codexRateLimits
  };
}
