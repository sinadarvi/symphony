import chokidar, { type FSWatcher } from "chokidar";
import { loadWorkflow, type WorkflowDefinition } from "./loader.js";

export type WorkflowReloadResult =
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; error: unknown };

export function watchWorkflow(
  workflowPath: string,
  onReload: (result: WorkflowReloadResult) => void
): FSWatcher {
  const watcher = chokidar.watch(workflowPath, { ignoreInitial: true });
  watcher.on("change", async () => {
    try {
      onReload({ ok: true, workflow: await loadWorkflow(workflowPath) });
    } catch (error) {
      onReload({ ok: false, error });
    }
  });
  return watcher;
}
