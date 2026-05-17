import path from "node:path";
import { loadWorkflow } from "./workflow/loader.js";
import { resolveConfig } from "./config/resolve.js";
import { assertDispatchConfig } from "./config/validate.js";
import { LinearClient } from "./tracker/linear/client.js";
import { createInitialState } from "./orchestrator/state.js";
import { Scheduler } from "./orchestrator/scheduler.js";
import { AgentWorker } from "./agent/worker.js";
import { Logger } from "./observability/logger.js";
import { startHttpServer } from "./observability/http-server.js";

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
    state.running.set(issue.id, {
      issue,
      attempt: null,
      startedAt: Date.now(),
      status: "PreparingWorkspace",
      stop: async () => undefined
    });
    const worker = new AgentWorker({ config, tracker, workflowPromptTemplate: workflow.promptTemplate });
    const result = await worker.run(issue, null);
    state.running.delete(issue.id);
    state.claimed.delete(issue.id);
    logger.info("worker_exit", { issue_id: issue.id, issue_identifier: issue.identifier, status: result.status, mode: result.mode });
  });

  const port = options.port ?? config.server.port;
  if (port !== null) {
    await startHttpServer(state, port);
    logger.info("http_server_started", { port });
  }

  await scheduler.tick();
  if (options.once) return;

  setInterval(() => {
    scheduler.tick().catch((error) => logger.error("tick_failed", { error: error instanceof Error ? error.message : String(error) }));
  }, config.polling.intervalMs);
}
