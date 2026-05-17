import type { EffectiveConfig } from "../config/schema.js";
import type { Issue } from "../tracker/types.js";

export type RunAttemptStatus =
  | "PreparingWorkspace"
  | "BuildingPrompt"
  | "LaunchingAgentProcess"
  | "InitializingSession"
  | "StreamingTurn"
  | "Finishing"
  | "Succeeded"
  | "Failed"
  | "TimedOut"
  | "Stalled"
  | "CanceledByReconciliation";

export type RunningEntry = {
  issue: Issue;
  attempt: number | null;
  startedAt: number;
  status: RunAttemptStatus;
  stop: () => Promise<void> | void;
  lastCodexTimestamp?: number | null;
  turnCount?: number;
};

export type RetryEntry = {
  issueId: string;
  identifier: string;
  attempt: number;
  dueAtMs: number;
  timerHandle: ReturnType<typeof setTimeout> | null;
  error: string | null;
};

export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  endedRuntimeSeconds: number;
};

export type OrchestratorState = {
  pollIntervalMs: number;
  maxConcurrentAgents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retryAttempts: Map<string, RetryEntry>;
  completed: Set<string>;
  codexTotals: TokenTotals;
  codexRateLimits: unknown;
};

export function createInitialState(config: EffectiveConfig): OrchestratorState {
  return {
    pollIntervalMs: config.polling.intervalMs,
    maxConcurrentAgents: config.agent.maxConcurrentAgents,
    running: new Map(),
    claimed: new Set(),
    retryAttempts: new Map(),
    completed: new Set(),
    codexTotals: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      endedRuntimeSeconds: 0
    },
    codexRateLimits: null
  };
}
