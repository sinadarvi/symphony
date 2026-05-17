import type { OrchestratorState, RetryEntry } from "./state.js";

export function scheduleRetryDelayMs(input: { attempt: number; cleanExit: boolean; maxRetryBackoffMs: number }): number {
  if (input.cleanExit) return 1_000;
  return Math.min(10_000 * 2 ** Math.max(input.attempt - 1, 0), input.maxRetryBackoffMs);
}

export function queueRetry(
  state: OrchestratorState,
  input: { issueId: string; identifier: string; attempt: number; delayMs: number; error: string | null; onDue: () => void }
): RetryEntry {
  const existing = state.retryAttempts.get(input.issueId);
  if (existing?.timerHandle) clearTimeout(existing.timerHandle);
  const entry: RetryEntry = {
    issueId: input.issueId,
    identifier: input.identifier,
    attempt: input.attempt,
    dueAtMs: Date.now() + input.delayMs,
    timerHandle: setTimeout(input.onDue, input.delayMs),
    error: input.error
  };
  state.retryAttempts.set(input.issueId, entry);
  state.claimed.add(input.issueId);
  return entry;
}

export function releaseClaim(state: OrchestratorState, issueId: string): void {
  const retry = state.retryAttempts.get(issueId);
  if (retry?.timerHandle) clearTimeout(retry.timerHandle);
  state.retryAttempts.delete(issueId);
  state.running.delete(issueId);
  state.claimed.delete(issueId);
}
