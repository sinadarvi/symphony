import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultEffectiveConfig } from "../src/config/defaults.js";
import { authorizeImplementation } from "../src/planning/authorization.js";
import { WorkspaceManager } from "../src/workspace/manager.js";
import { sanitizeWorkspaceKey } from "../src/workspace/paths.js";

describe("workspace and planning behavior", () => {
  it("sanitizes issue identifiers for workspace keys", () => {
    expect(sanitizeWorkspaceKey("ABC/123: hello")).toBe("ABC_123__hello");
  });

  it("creates a contained workspace and runs after_create only once", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "symphony-workspaces-"));
    const config = defaultEffectiveConfig({
      workspace: { root },
      hooks: {
        afterCreate: "printf created >> marker.txt",
        beforeRun: null,
        afterRun: null,
        beforeRemove: null,
        timeoutMs: 1_000
      }
    });
    const manager = new WorkspaceManager(config);

    const first = await manager.ensureForIssue("SYM/1");
    const second = await manager.ensureForIssue("SYM/1");

    expect(first.createdNow).toBe(true);
    expect(second.createdNow).toBe(false);
    expect(first.path.startsWith(root + path.sep)).toBe(true);
    expect(await readFile(path.join(first.path, "marker.txt"), "utf8")).toBe("created");
  });

  it("runs before_remove but ignores its failure before removing the workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "symphony-workspaces-"));
    const config = defaultEffectiveConfig({
      workspace: { root },
      hooks: {
        afterCreate: null,
        beforeRun: null,
        afterRun: null,
        beforeRemove: "exit 7",
        timeoutMs: 1_000
      }
    });
    const manager = new WorkspaceManager(config);
    const workspace = await manager.ensureForIssue("SYM-2");
    await writeFile(path.join(workspace.path, "file.txt"), "content");

    await manager.remove(workspace.path);

    await expect(readFile(path.join(workspace.path, "file.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("requires mention, phrase, and optional authorized requester for implementation", () => {
    const allowed = authorizeImplementation(
      [
        { id: "c1", body: "Looks good. <@symphony> implement", author: { id: "user-1", email: "u@example.com" } }
      ],
      {
        assistantMention: "@symphony",
        implementationPhrase: "implement",
        authorizedRequesters: ["u@example.com"]
      }
    );
    const denied = authorizeImplementation(
      [{ id: "c2", body: "@symphony implement", author: { id: "other", email: "other@example.com" } }],
      {
        assistantMention: "@symphony",
        implementationPhrase: "implement",
        authorizedRequesters: ["u@example.com"]
      }
    );

    expect(allowed.authorized).toBe(true);
    expect(allowed.requester).toBe("u@example.com");
    expect(denied.authorized).toBe(false);
  });
});
