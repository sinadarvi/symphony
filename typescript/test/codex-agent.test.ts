import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultEffectiveConfig } from "../src/config/defaults.js";
import { AgentWorker } from "../src/agent/worker.js";
import { CodexAppServerClient } from "../src/codex/app-server-client.js";
import { createLinearGraphqlTool } from "../src/codex/tools/linear-graphql.js";
import type { Issue, IssueTrackerClient } from "../src/tracker/types.js";

describe("Codex client and agent worker", () => {
  it("runs a fake line-delimited app-server process and emits normalized events", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-codex-"));
    const script = path.join(dir, "fake-app-server.mjs");
    await writeFile(
      script,
      [
        "process.stdin.resume();",
        "console.log(JSON.stringify({ event: 'session_started', thread_id: 't1' }));",
        "console.log(JSON.stringify({ event: 'turn_started', turn_id: 'r1' }));",
        "console.log(JSON.stringify({ event: 'thread/tokenUsage/updated', usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } }));",
        "console.log(JSON.stringify({ event: 'turn_completed', message: 'plan text' }));"
      ].join("\n")
    );
    const workspace = path.join(dir, "workspace");
    await mkdir(workspace);
    const client = new CodexAppServerClient({
      command: `node ${JSON.stringify(script)}`,
      readTimeoutMs: 1_000,
      turnTimeoutMs: 1_000,
      stallTimeoutMs: 0
    });

    const events = [];
    for await (const event of client.runTurn({ workspacePath: workspace, input: "hello" })) {
      events.push(event);
    }

    expect(events.map((event) => event.event)).toEqual([
      "session_started",
      "turn_started",
      "thread/tokenUsage/updated",
      "turn_completed"
    ]);
    expect(events.at(-1)?.sessionId).toBe("t1-r1");
  });

  it("keeps one app-server process alive across continuation turns until explicitly stopped", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-codex-"));
    const stopMarker = path.join(dir, "stopped.txt");
    const script = path.join(dir, "fake-persistent-app-server.mjs");
    await writeFile(
      script,
      [
        "import fs from 'node:fs';",
        `const marker = ${JSON.stringify(stopMarker)};`,
        "let turns = 0;",
        "process.stdin.resume();",
        "process.on('SIGTERM', () => { fs.writeFileSync(marker, 'stopped'); process.exit(0); });",
        "process.stdin.on('data', () => {",
        "  turns += 1;",
        "  if (turns === 1) console.log(JSON.stringify({ event: 'session_started', thread_id: 't1' }));",
        "  console.log(JSON.stringify({ event: 'turn_started', turn_id: `r${turns}` }));",
        "  console.log(JSON.stringify({ event: 'turn_completed', message: `turn ${turns}` }));",
        "});"
      ].join("\n")
    );
    const workspace = path.join(dir, "workspace");
    await mkdir(workspace);
    const client = new CodexAppServerClient({
      command: `node ${JSON.stringify(script)}`,
      readTimeoutMs: 1_000,
      turnTimeoutMs: 1_000,
      stallTimeoutMs: 0
    });

    const first = [];
    for await (const event of client.runTurn({ workspacePath: workspace, input: "first" })) first.push(event);
    await expect(readFile(stopMarker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const second = [];
    for await (const event of client.runTurn({ workspacePath: workspace, input: "second" })) second.push(event);
    await client.stop();

    expect(first.at(-1)?.sessionId).toBe("t1-r1");
    expect(second.at(-1)?.sessionId).toBe("t1-r2");
    expect(await readFile(stopMarker, "utf8")).toBe("stopped");
  });

  it("rejects unsupported or multi-operation linear_graphql tool input", async () => {
    const tool = createLinearGraphqlTool({
      endpoint: "https://linear.test/graphql",
      apiKey: "secret",
      fetchImpl: vi.fn()
    });

    expect(await tool({ query: "query A { viewer { id } } query B { viewer { id } }" })).toMatchObject({
      success: false
    });
    expect(await tool({ variables: [] })).toMatchObject({ success: false });
  });

  it("runs a planning worker and writes the planning record before authorization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "symphony-agent-"));
    const config = defaultEffectiveConfig({
      workspace: { root },
      tracker: {
        kind: "linear",
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo"],
        terminalStates: ["Done"]
      },
      hooks: {
        afterCreate: null,
        beforeRun: null,
        afterRun: null,
        beforeRemove: null,
        timeoutMs: 1_000
      }
    });
    const issue: Issue = {
      id: "id-1",
      identifier: "SYM-1",
      title: "Title",
      description: null,
      priority: null,
      state: "Todo",
      branchName: null,
      url: null,
      labels: [],
      blockedBy: [],
      createdAt: null,
      updatedAt: null
    };
    const writes: string[] = [];
    const tracker: Pick<IssueTrackerClient, "fetchIssueDiscussion" | "writePlanningRecord" | "fetchIssueStatesByIds"> = {
      fetchIssueDiscussion: async () => ({ description: "", comments: [] }),
      writePlanningRecord: async (_issueId, content) => {
        writes.push(content);
      },
      fetchIssueStatesByIds: async () => [issue]
    };
    const worker = new AgentWorker({
      config,
      tracker,
      workflowPromptTemplate: "Issue {{ issue.identifier }} mode {{ mode }}",
      codexClientFactory: () => ({
        runTurn: async function* () {
          yield { event: "turn_completed", timestamp: new Date(), message: "Planning artifact" };
        },
        stop: async () => undefined
      })
    });

    const result = await worker.run(issue, null);

    expect(result.status).toBe("succeeded");
    expect(writes).toEqual(["Planning artifact"]);
  });

  it("stops the codex session when an implementation worker finishes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "symphony-agent-"));
    const config = defaultEffectiveConfig({
      workspace: { root },
      tracker: {
        kind: "linear",
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo"],
        terminalStates: ["Done"]
      },
      agent: {
        maxConcurrentAgents: 1,
        maxTurns: 2,
        maxRetryBackoffMs: 300_000,
        maxConcurrentAgentsByState: {}
      }
    });
    const issue: Issue = {
      id: "id-1",
      identifier: "SYM-1",
      title: "Title",
      description: null,
      priority: null,
      state: "Todo",
      branchName: null,
      url: null,
      labels: [],
      blockedBy: [],
      createdAt: null,
      updatedAt: null
    };
    const stop = vi.fn();
    const tracker: Pick<IssueTrackerClient, "fetchIssueDiscussion" | "writePlanningRecord" | "fetchIssueStatesByIds"> = {
      fetchIssueDiscussion: async () => ({
        description: "",
        comments: [{ id: "comment-1", body: "@symphony implement", author: { email: "lead@example.com" } }]
      }),
      writePlanningRecord: async () => undefined,
      fetchIssueStatesByIds: async () => [issue]
    };
    const worker = new AgentWorker({
      config,
      tracker,
      workflowPromptTemplate: "Issue {{ issue.identifier }} mode {{ mode }}",
      codexClientFactory: () => ({
        runTurn: async function* () {
          yield { event: "turn_completed", timestamp: new Date(), message: "done" };
        },
        stop
      })
    });

    const result = await worker.run(issue, null);

    expect(result.status).toBe("succeeded");
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
