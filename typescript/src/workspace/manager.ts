import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { EffectiveConfig } from "../config/schema.js";
import { runHook } from "./hooks.js";
import { assertPathInsideRoot, workspacePathForIssue } from "./paths.js";

export type WorkspaceInfo = {
  path: string;
  workspaceKey: string;
  createdNow: boolean;
};

export class WorkspaceManager {
  constructor(private readonly config: EffectiveConfig) {}

  async ensureForIssue(identifier: string): Promise<WorkspaceInfo> {
    const workspacePath = workspacePathForIssue(this.config.workspace.root, identifier);
    const workspaceKey = path.basename(workspacePath);
    let createdNow = false;

    try {
      const existing = await stat(workspacePath);
      if (!existing.isDirectory()) {
        await rm(workspacePath, { recursive: true, force: true });
        await mkdir(workspacePath, { recursive: true });
        createdNow = true;
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
      await mkdir(workspacePath, { recursive: true });
      createdNow = true;
    }

    if (createdNow && this.config.hooks.afterCreate) {
      await runHook(this.config.hooks.afterCreate, workspacePath, this.config.hooks.timeoutMs);
    }

    return { path: workspacePath, workspaceKey, createdNow };
  }

  async runBeforeRun(workspacePath: string): Promise<void> {
    assertPathInsideRoot(this.config.workspace.root, workspacePath);
    if (this.config.hooks.beforeRun) {
      await runHook(this.config.hooks.beforeRun, workspacePath, this.config.hooks.timeoutMs);
    }
  }

  async runAfterRun(workspacePath: string): Promise<void> {
    assertPathInsideRoot(this.config.workspace.root, workspacePath);
    if (this.config.hooks.afterRun) {
      await runHook(this.config.hooks.afterRun, workspacePath, this.config.hooks.timeoutMs).catch(() => undefined);
    }
  }

  async remove(workspacePath: string): Promise<void> {
    assertPathInsideRoot(this.config.workspace.root, workspacePath);
    if (this.config.hooks.beforeRemove) {
      await runHook(this.config.hooks.beforeRemove, workspacePath, this.config.hooks.timeoutMs).catch(() => undefined);
    }
    await rm(workspacePath, { recursive: true, force: true });
  }

  async removeForIssue(identifier: string): Promise<void> {
    await this.remove(workspacePathForIssue(this.config.workspace.root, identifier));
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
