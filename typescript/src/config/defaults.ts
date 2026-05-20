import os from "node:os";
import path from "node:path";
import type { EffectiveConfig } from "./schema.js";

export function defaultEffectiveConfig(overrides: DeepPartial<EffectiveConfig> = {}): EffectiveConfig {
  return deepMerge(
    {
      workflowPath: path.resolve("WORKFLOW.md"),
      workflowStates: {},
      tracker: {
        kind: null,
        endpoint: "https://api.linear.app/graphql",
        apiKey: null,
        projectSlug: null,
        activeStates: ["Todo", "In Progress"],
        terminalStates: ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]
      },
      polling: {
        intervalMs: 30_000
      },
      workspace: {
        root: path.join(os.tmpdir(), "symphony_workspaces")
      },
      hooks: {
        afterCreate: null,
        beforeRun: null,
        afterRun: null,
        beforeRemove: null,
        timeoutMs: 60_000
      },
      agent: {
        maxConcurrentAgents: 10,
        maxTurns: 20,
        maxRetryBackoffMs: 300_000,
        maxConcurrentAgentsByState: {}
      },
      planning: {
        assistantMention: "@symphony",
        assistantAuthors: null,
        implementationPhrase: "implement",
        authorizedRequesters: null,
        planningRecordLocation: "description"
      },
      conversation: {
        assistantAuthors: null,
        respondToComments: true,
        respondToReplies: true,
        sameThreadReplies: true
      },
      codex: {
        command: "codex app-server",
        approvalPolicy: "never",
        threadSandbox: "workspace-write",
        turnSandboxPolicy: null,
        turnTimeoutMs: 3_600_000,
        readTimeoutMs: 5_000,
        stallTimeoutMs: 300_000
      },
      server: {
        port: null
      }
    },
    overrides
  );
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

function deepMerge<T>(base: T, overrides: DeepPartial<T>): T {
  if (!isRecord(base) || !isRecord(overrides)) return (overrides ?? base) as T;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const existing = result[key];
    result[key] = isRecord(existing) && isRecord(value) ? deepMerge(existing, value) : value;
  }
  return result as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
