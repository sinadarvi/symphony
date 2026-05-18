import path from "node:path";
import { loadWorkflow } from "./workflow/loader.js";
import { resolveConfig } from "./config/resolve.js";
import { assertDispatchConfig } from "./config/validate.js";
import { LinearClient } from "./tracker/linear/client.js";
import { createInitialState } from "./orchestrator/state.js";
import { Scheduler } from "./orchestrator/scheduler.js";
import { AgentWorker } from "./agent/worker.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";
import { Logger } from "./observability/logger.js";
import { startHttpServer } from "./observability/http-server.js";
import { formatErrorReport } from "./shared/errors.js";

export type StartOptions = {
  workflowPath?: string;
  once?: boolean;
  port?: number | null;
};

export async function startSymphony(options: StartOptions = {}): Promise<void> {
  const logger = new Logger();
  const workflowPath = path.resolve(options.workflowPath ?? "WORKFLOW.md");
  const workflow = await loadWorkflow(workflowPath);
  const config = resolveConfig(workflow.config, workflowPath);
  assertDispatchConfig(config);

  const tracker = new LinearClient({
    endpoint: config.tracker.endpoint,
    apiKey: config.tracker.apiKey ?? "",
    projectSlug: config.tracker.projectSlug ?? "",
    activeStates: config.tracker.activeStates,
    terminalStates: config.tracker.terminalStates
  });
  const state = createInitialState(config);
  const scheduler = new Scheduler(state, config, tracker, async (issue) => {
    let client: CodexAppServerClient | null = null;
    state.running.set(issue.id, {
      issue,
      attempt: null,
      startedAt: Date.now(),
      status: "PreparingWorkspace",
      stop: async () => client?.stop()
    });
    const worker = new AgentWorker({
      config,
      tracker,
      workflowPromptTemplate: workflow.promptTemplate,
      codexClientFactory: () => {
        client = new CodexAppServerClient(config.codex);
        const running = state.running.get(issue.id);
        if (running) running.stop = async () => client?.stop();
        return client;
      }
    });
    const result = await worker.run(issue, null);
    state.running.delete(issue.id);
    state.claimed.delete(issue.id);
    logger.info("worker_exit", {
      issue_id: issue.id,
      issue_identifier: issue.identifier,
      status: result.status,
      mode: result.mode,
      reason: result.reason,
      error: result.error ? formatErrorReport(result.error) : undefined
    });
  });

  const port = options.port ?? config.server.port;
  if (port !== null) {
    await startHttpServer(state, port);
    logger.info("http_server_started", { port });
  }

  await scheduler.tick();
  if (options.once) return;

  const interval = setInterval(() => {
    scheduler.tick().catch((error) => logger.error("tick_failed", { error: error instanceof Error ? error.message : String(error) }));
  }, config.polling.intervalMs);

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(interval);
    logger.info("shutdown_started", { signal, running: state.running.size });
    await Promise.allSettled([...state.running.values()].map((entry) => Promise.resolve(entry.stop())));
    logger.info("shutdown_complete", { signal });
    process.exitCode = signal === "SIGINT" ? 130 : 143;
  };
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}
