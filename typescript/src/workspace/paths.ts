import path from "node:path";
import { SymphonyError } from "../shared/errors.js";

export function sanitizeWorkspaceKey(identifier: string): string {
  return (identifier || "issue").replace(/[^A-Za-z0-9._-]/g, "_");
}

export function workspacePathForIssue(root: string, identifier: string): string {
  const normalizedRoot = path.resolve(root);
  const workspace = path.resolve(normalizedRoot, sanitizeWorkspaceKey(identifier));
  assertPathInsideRoot(normalizedRoot, workspace);
  return workspace;
}

export function assertPathInsideRoot(root: string, workspacePath: string): void {
  const normalizedRoot = path.resolve(root);
  const normalizedWorkspace = path.resolve(workspacePath);
  const relative = path.relative(normalizedRoot, normalizedWorkspace);
  if (relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new SymphonyError("workspace_path_escape", "Workspace path must remain inside workspace root", {
    context: { root: normalizedRoot, workspacePath: normalizedWorkspace }
  });
}
