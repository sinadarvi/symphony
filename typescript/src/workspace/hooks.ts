import { spawn } from "node:child_process";
import { SymphonyError } from "../shared/errors.js";

export type HookResult = {
  stdout: string;
  stderr: string;
};

export async function runHook(script: string, cwd: string, timeoutMs: number): Promise<HookResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", script], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = 64 * 1024;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = boundedAppend(stdout, chunk.toString("utf8"), cap);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk.toString("utf8"), cap);
    });
    child.on("error", (cause) => {
      clearTimeout(timer);
      reject(new SymphonyError("hook_failed", "Hook process failed to start", { cause }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new SymphonyError("hook_timeout", `Hook timed out after ${timeoutMs}ms`, { context: { stdout, stderr } }));
        return;
      }
      if (code !== 0) {
        reject(new SymphonyError("hook_failed", `Hook exited with status ${code}`, { context: { stdout, stderr, code } }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function boundedAppend(current: string, next: string, cap: number): string {
  const combined = current + next;
  return combined.length <= cap ? combined : combined.slice(combined.length - cap);
}
