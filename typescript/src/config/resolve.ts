import os from "node:os";
import path from "node:path";
import { SymphonyError } from "../shared/errors.js";
import { defaultEffectiveConfig } from "./defaults.js";
import { normalizeIssueState, type EffectiveConfig, type PlanningRecordLocation } from "./schema.js";

export function resolveConfig(
  rawConfig: Record<string, unknown>,
  workflowPath: string,
  env: NodeJS.ProcessEnv = process.env
): EffectiveConfig {
  const workflowDir = path.dirname(path.resolve(workflowPath));
  const tracker = record(rawConfig.tracker);
  const polling = record(rawConfig.polling);
  const workspace = record(rawConfig.workspace);
  const hooks = record(rawConfig.hooks);
  const agent = record(rawConfig.agent);
  const planning = record(rawConfig.planning);
  const codex = record(rawConfig.codex);
  const server = record(rawConfig.server);

  const kind = stringOrNull(tracker.kind);
  const config = defaultEffectiveConfig({
    workflowPath: path.resolve(workflowPath),
    tracker: {
      kind,
      endpoint: stringOrNull(tracker.endpoint) ?? (kind === "linear" || kind === null ? "https://api.linear.app/graphql" : ""),
      apiKey: resolveSecret(stringOrNull(tracker.api_key) ?? (kind === "linear" ? "$LINEAR_API_KEY" : null), env),
      projectSlug: stringOrNull(tracker.project_slug),
      activeStates: stringArray(tracker.active_states) ?? ["Todo", "In Progress"],
      terminalStates: stringArray(tracker.terminal_states) ?? ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]
    },
    polling: {
      intervalMs: optionalPositiveInteger(polling.interval_ms, "polling.interval_ms", 30_000)
    },
    workspace: {
      root: resolvePath(stringOrNull(workspace.root) ?? path.join(os.tmpdir(), "symphony_workspaces"), workflowDir, env)
    },
    hooks: {
      afterCreate: stringOrNull(hooks.after_create),
      beforeRun: stringOrNull(hooks.before_run),
      afterRun: stringOrNull(hooks.after_run),
      beforeRemove: stringOrNull(hooks.before_remove),
      timeoutMs: optionalPositiveInteger(hooks.timeout_ms, "hooks.timeout_ms", 60_000)
    },
    agent: {
      maxConcurrentAgents: optionalPositiveInteger(agent.max_concurrent_agents, "agent.max_concurrent_agents", 10),
      maxTurns: optionalPositiveInteger(agent.max_turns, "agent.max_turns", 20),
      maxRetryBackoffMs: optionalPositiveInteger(agent.max_retry_backoff_ms, "agent.max_retry_backoff_ms", 300_000),
      maxConcurrentAgentsByState: stateLimitMap(agent.max_concurrent_agents_by_state)
    },
    planning: {
      assistantMention: stringOrNull(planning.assistant_mention) ?? "@symphony",
      assistantAuthors: stringArray(planning.assistant_authors),
      implementationPhrase: stringOrNull(planning.implementation_phrase) ?? "implement",
      authorizedRequesters: stringArray(planning.authorized_requesters),
      planningRecordLocation: planningRecordLocation(planning.planning_record_location)
    },
    codex: {
      command: stringOrNull(codex.command) ?? "codex app-server",
      approvalPolicy: codex.approval_policy ?? "never",
      threadSandbox: codex.thread_sandbox ?? "workspace-write",
      turnSandboxPolicy: codex.turn_sandbox_policy ?? null,
      turnTimeoutMs: optionalPositiveInteger(codex.turn_timeout_ms, "codex.turn_timeout_ms", 3_600_000),
      readTimeoutMs: optionalPositiveInteger(codex.read_timeout_ms, "codex.read_timeout_ms", 5_000),
      stallTimeoutMs: optionalInteger(codex.stall_timeout_ms, "codex.stall_timeout_ms", 300_000)
    },
    server: {
      port: optionalNonNegativeInteger(server.port, "server.port", null)
    }
  });

  return config;
}

export function validateDispatchConfig(config: EffectiveConfig): string[] {
  const errors: string[] = [];
  if (!config.tracker.kind) errors.push("missing_tracker_kind");
  if (config.tracker.kind && config.tracker.kind !== "linear") errors.push("unsupported_tracker_kind");
  if (config.tracker.kind === "linear" && !config.tracker.apiKey) errors.push("missing_tracker_api_key");
  if (config.tracker.kind === "linear" && !config.tracker.projectSlug) errors.push("missing_tracker_project_slug");
  if (!config.codex.command.trim()) errors.push("missing_codex_command");
  return errors;
}

function resolveSecret(value: string | null, env: NodeJS.ProcessEnv): string | null {
  if (!value) return null;
  if (!value.startsWith("$")) return value;
  const resolved = env[value.slice(1)] ?? "";
  return resolved.trim() === "" ? null : resolved;
}

function resolvePath(value: string, relativeTo: string, env: NodeJS.ProcessEnv): string {
  let resolved = value;
  if (resolved.startsWith("$")) resolved = env[resolved.slice(1)] ?? "";
  if (resolved.startsWith("~")) resolved = path.join(os.homedir(), resolved.slice(1));
  if (!path.isAbsolute(resolved)) resolved = path.join(relativeTo, resolved);
  return path.resolve(resolved);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
  return strings.length > 0 ? strings : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = integer(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function optionalPositiveInteger(value: unknown, field: string, defaultValue: number): number {
  if (value === undefined || value === null) return defaultValue;
  const parsed = positiveInteger(value);
  if (parsed === null) throw new SymphonyError("invalid_workflow_config", `${field} must be a positive integer`);
  return parsed;
}

function optionalInteger(value: unknown, field: string, defaultValue: number): number {
  if (value === undefined || value === null) return defaultValue;
  const parsed = integer(value);
  if (parsed === null) throw new SymphonyError("invalid_workflow_config", `${field} must be an integer`);
  return parsed;
}

function optionalNonNegativeInteger(value: unknown, field: string, defaultValue: number | null): number | null {
  if (value === undefined || value === null) return defaultValue;
  const parsed = integer(value);
  if (parsed === null || parsed < 0) throw new SymphonyError("invalid_workflow_config", `${field} must be a non-negative integer`);
  return parsed;
}

function stateLimitMap(value: unknown): Record<string, number> {
  const input = record(value);
  const output: Record<string, number> = {};
  for (const [state, limit] of Object.entries(input)) {
    const parsed = positiveInteger(limit);
    if (parsed !== null) output[normalizeIssueState(state)] = parsed;
  }
  return output;
}

function planningRecordLocation(value: unknown): PlanningRecordLocation {
  return value === "comment" ? "comment" : "description";
}
