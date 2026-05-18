import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { SymphonyError } from "../shared/errors.js";
import { isTerminalCodexEvent, normalizeCodexEvent, record, type CodexRuntimeEvent } from "./events.js";
import type { CodexSession, RunTurnInput } from "./protocol.js";

export type CodexClientConfig = {
  command: string;
  approvalPolicy?: unknown;
  threadSandbox?: unknown;
  turnSandboxPolicy?: unknown;
  readTimeoutMs: number;
  turnTimeoutMs: number;
  stallTimeoutMs: number;
};

export class CodexAppServerClient implements CodexSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private workspacePath: string | null = null;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private buffer = "";
  private stderr = "";
  private closed = false;
  private readonly lines: string[] = [];
  private readonly eventBacklog: string[] = [];
  private readonly waiters: Array<() => void> = [];
  private nextRequestId = 1;
  private initialized = false;

  constructor(private readonly config: CodexClientConfig) {}

  async *runTurn(input: RunTurnInput): AsyncIterable<CodexRuntimeEvent> {
    const workspacePath = path.resolve(input.workspacePath);
    const child = this.ensureStarted(workspacePath);
    await this.ensureInitialized(workspacePath);
    if (!this.threadId) {
      await this.startThread(workspacePath);
    }
    let terminal = false;
    const turnResponse = await this.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: input.input, text_elements: [] }],
      cwd: workspacePath,
      approvalPolicy: this.configApprovalPolicy(),
      sandboxPolicy: this.config.turnSandboxPolicy ?? {
        type: "workspaceWrite",
        writableRoots: [workspacePath],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false
      }
    });
    const turn = record(record(turnResponse)?.turn);
    if (typeof turn?.id === "string") this.turnId = turn.id;

    const deadline = Date.now() + this.config.turnTimeoutMs;
    try {
      while (!terminal) {
        if (Date.now() > deadline) throw new SymphonyError("turn_timeout", `Codex turn timed out after ${this.config.turnTimeoutMs}ms`);
        if (this.lines.length === 0) {
          await this.waitForLine(Math.min(this.config.readTimeoutMs, Math.max(deadline - Date.now(), 1)));
        }
        const line = this.eventBacklog.shift() ?? this.lines.shift();
        if (line == null) {
          if (this.closed || child.exitCode !== null) {
            throw new SymphonyError("process_exit", "Codex app-server exited before turn completed", { context: { stderr: this.stderr } });
          }
          continue;
        }
        if (line.trim() === "") continue;
        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse(line) as Record<string, unknown>;
        } catch {
          raw = { event: "malformed", message: line };
        }
        if (typeof raw.thread_id === "string") this.threadId = raw.thread_id;
        if (typeof raw.threadId === "string") this.threadId = raw.threadId;
        if (typeof raw.turn_id === "string") this.turnId = raw.turn_id;
        if (typeof raw.turnId === "string") this.turnId = raw.turnId;
        const event = normalizeCodexEvent(raw, { threadId: this.threadId, turnId: this.turnId, pid: child.pid ?? null });
        yield event;
        terminal = isTerminalCodexEvent(event);
        if (["turn_failed", "turn_cancelled", "turn_ended_with_error"].includes(event.event)) {
          throw new SymphonyError("turn_failed", `Codex turn ended with ${event.event}`);
        }
        if (event.event === "turn_input_required") {
          throw new SymphonyError("turn_input_required", "Codex requested user input");
        }
      }
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.child || this.child.killed || this.child.exitCode !== null) return;
    this.child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 250);
      this.child?.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private ensureStarted(workspacePath: string): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      if (this.workspacePath !== workspacePath) {
        throw new SymphonyError("invalid_workspace_cwd", "Cannot reuse Codex app-server process for a different workspace", {
          context: { existingWorkspacePath: this.workspacePath, workspacePath }
        });
      }
      return this.child;
    }

    this.workspacePath = workspacePath;
    this.buffer = "";
    this.stderr = "";
    this.closed = false;
    this.lines.splice(0);
    this.waiters.splice(0);
    this.child = spawn("bash", ["-lc", this.config.command], {
      cwd: workspacePath,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const child = this.child;
    child.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      for (;;) {
        const index = this.buffer.indexOf("\n");
        if (index === -1) break;
        this.lines.push(this.buffer.slice(0, index));
        this.buffer = this.buffer.slice(index + 1);
      }
      this.wake();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = boundedAppend(this.stderr, chunk.toString("utf8"), 64 * 1024);
    });
    child.on("close", () => {
      this.closed = true;
      if (this.buffer.trim()) this.lines.push(this.buffer.trim());
      this.wake();
    });
    return child;
  }

  private async ensureInitialized(workspacePath: string): Promise<void> {
    if (this.initialized) return;
    await this.request("initialize", {
      clientInfo: { name: "symphony-typescript", title: "Symphony TypeScript", version: "0.1.0" },
      capabilities: { experimentalApi: true }
    });
    this.initialized = true;
  }

  private async startThread(workspacePath: string): Promise<void> {
    const response = await this.request("thread/start", {
      cwd: workspacePath,
      approvalPolicy: this.configApprovalPolicy(),
      sandbox: this.config.threadSandbox ?? "workspace-write",
      ephemeral: true
    });
    const thread = record(record(response)?.thread);
    if (typeof thread?.id !== "string") {
      throw new SymphonyError("response_error", "Codex thread/start response did not include thread id");
    }
    this.threadId = thread.id;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (!child) throw new SymphonyError("process_exit", "Codex app-server process is not running");
    const id = this.nextRequestId++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const deadline = Date.now() + this.config.readTimeoutMs;

    for (;;) {
      if (Date.now() > deadline) throw new SymphonyError("response_timeout", `Codex request ${method} timed out after ${this.config.readTimeoutMs}ms`);
      if (this.lines.length === 0) {
        await this.waitForLine(Math.min(250, Math.max(deadline - Date.now(), 1)));
      }
      const line = this.lines.shift();
      if (line == null) {
        if (this.closed || child.exitCode !== null) {
          throw new SymphonyError("process_exit", "Codex app-server exited before responding", { context: { method, stderr: this.stderr } });
        }
        continue;
      }
      if (line.trim() === "") continue;
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (raw.id === id) {
        if (raw.error) {
          throw new SymphonyError("response_error", `Codex request ${method} failed`, { context: { error: raw.error } });
        }
        return raw.result;
      }
      this.eventBacklog.push(line);
    }
  }

  private configApprovalPolicy(): unknown {
    return this.config.approvalPolicy ?? "never";
  }

  private waitForLine(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private wake(): void {
    this.waiters.splice(0).forEach((waiter) => waiter());
  }
}

function boundedAppend(current: string, next: string, cap: number): string {
  const combined = current + next;
  return combined.length <= cap ? combined : combined.slice(combined.length - cap);
}
