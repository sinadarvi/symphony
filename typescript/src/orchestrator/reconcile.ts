import { normalizeIssueState, type EffectiveConfig } from "../config/schema.js";
import type { IssueTrackerClient } from "../tracker/types.js";
import type { OrchestratorState, RunningEntry } from "./state.js";
import { releaseClaim } from "./retry.js";

export type ReconcileEffects = {
  cleanupWorkspace: (identifier: string) => Promise<void> | void;
};

export async function reconcileRunning(
  state: OrchestratorState,
  config: EffectiveConfig,
  tracker: Pick<IssueTrackerClient, "fetchIssueStatesByIds">,
  effects: ReconcileEffects
): Promise<void> {
  await stopStalled(state, config);
  const ids = [...state.running.keys()];
  if (ids.length === 0) return;

  let refreshed;
  try {
    refreshed = await tracker.fetchIssueStatesByIds(ids);
  } catch {
    return;
  }

  const byId = new Map(refreshed.map((issue) => [issue.id, issue]));
  const active = new Set(config.tracker.activeStates.map(normalizeIssueState));
  const terminal = new Set(config.tracker.terminalStates.map(normalizeIssueState));

  for (const [issueId, entry] of [...state.running]) {
    const latest = byId.get(issueId);
    if (!latest) {
      await stopEntry(entry);
      releaseClaim(state, issueId);
      continue;
    }
    const latestState = normalizeIssueState(latest.state);
    if (terminal.has(latestState)) {
      await stopEntry(entry);
      await effects.cleanupWorkspace(entry.issue.identifier);
      releaseClaim(state, issueId);
    } else if (active.has(latestState)) {
      entry.issue = latest;
    } else {
      await stopEntry(entry);
      releaseClaim(state, issueId);
    }
  }
}

async function stopStalled(state: OrchestratorState, config: EffectiveConfig): Promise<void> {
  if (config.codex.stallTimeoutMs <= 0) return;
  const now = Date.now();
  for (const [issueId, entry] of [...state.running]) {
    const since = entry.lastCodexTimestamp ?? entry.startedAt;
    if (now - since > config.codex.stallTimeoutMs) {
      await stopEntry(entry);
      state.running.delete(issueId);
      state.claimed.delete(issueId);
    }
  }
}

async function stopEntry(entry: RunningEntry): Promise<void> {
  await entry.stop();
}
