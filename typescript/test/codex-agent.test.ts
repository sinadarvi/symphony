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
  it("runs a fake JSON-RPC app-server process and emits normalized events", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-codex-"));
    const script = path.join(dir, "fake-app-server.mjs");
    await writeFile(
      script,
      [
        "process.stdin.setEncoding('utf8');",
        "let buffer = '';",
        "process.stdin.on('data', (chunk) => {",
        "  buffer += chunk;",
        "  let index;",
        "  while ((index = buffer.indexOf('\\n')) >= 0) {",
        "    const line = buffer.slice(0, index);",
        "    buffer = buffer.slice(index + 1);",
        "    if (!line.trim()) continue;",
        "    const request = JSON.parse(line);",
        "    if (request.method === 'initialize') console.log(JSON.stringify({ id: request.id, result: { userAgent: 'fake', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'macos' } }));",
        "    if (request.method === 'thread/start') console.log(JSON.stringify({ id: request.id, result: { thread: { id: 't1' } } }));",
        "    if (request.method === 'turn/start') {",
        "      console.log(JSON.stringify({ id: request.id, result: { turn: { id: 'r1' } } }));",
        "      console.log(JSON.stringify({ method: 'turn/started', params: { threadId: 't1', turn: { id: 'r1' } } }));",
        "      console.log(JSON.stringify({ method: 'thread/tokenUsage/updated', params: { threadId: 't1', turnId: 'r1', tokenUsage: { total: { inputTokens: 3, outputTokens: 4, totalTokens: 7 } } } }));",
        "      console.log(JSON.stringify({ method: 'item/completed', params: { threadId: 't1', turnId: 'r1', item: { type: 'agentMessage', text: 'plan text' } } }));",
        "      console.log(JSON.stringify({ method: 'turn/completed', params: { threadId: 't1', turn: { id: 'r1', status: 'completed' } } }));",
        "    }",
        "  }",
        "});"
      ].join("\n")
    );
    const workspace = path.join(dir, "workspace");
    await mkdir(workspace);
    const client = new CodexAppServerClient({
      command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`,
      readTimeoutMs: 1_000,
      turnTimeoutMs: 1_000,
      stallTimeoutMs: 0
    });

    const events = [];
    for await (const event of client.runTurn({ workspacePath: workspace, input: "hello" })) {
      events.push(event);
    }

    expect(events.map((event) => event.event)).toEqual(["turn/started", "thread/tokenUsage/updated", "item/completed", "turn/completed"]);
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
        "let buffer = '';",
        "let initialized = false;",
        "let threadStarted = false;",
        "function stop() { fs.writeFileSync(marker, 'stopped'); process.exit(0); }",
        "process.on('SIGTERM', stop);",
        "process.stdin.on('end', stop);",
        "process.stdin.on('data', (chunk) => {",
        "  buffer += chunk;",
        "  let index;",
        "  while ((index = buffer.indexOf('\\n')) >= 0) {",
        "    const line = buffer.slice(0, index);",
        "    buffer = buffer.slice(index + 1);",
        "    if (!line.trim()) continue;",
        "    const request = JSON.parse(line);",
        "    if (request.method === 'initialize') { initialized = true; console.log(JSON.stringify({ id: request.id, result: { userAgent: 'fake', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'macos' } })); }",
        "    if (request.method === 'thread/start') { threadStarted = true; console.log(JSON.stringify({ id: request.id, result: { thread: { id: 't1' } } })); }",
        "    if (request.method === 'turn/start') {",
        "      turns += 1;",
        "      console.log(JSON.stringify({ id: request.id, result: { turn: { id: `r${turns}` } } }));",
        "      console.log(JSON.stringify({ method: 'turn/started', params: { threadId: 't1', turn: { id: `r${turns}` } } }));",
        "      console.log(JSON.stringify({ method: 'turn/completed', params: { threadId: 't1', turn: { id: `r${turns}`, status: 'completed' } } }));",
        "    }",
        "  }",
        "});"
      ].join("\n")
    );
    const workspace = path.join(dir, "workspace");
    await mkdir(workspace);
    const client = new CodexAppServerClient({
      command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`,
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

  it("reports app-server launch failures instead of crashing on child process errors", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-codex-"));
    const workspace = path.join(dir, "workspace");
    await mkdir(workspace);
    const client = new CodexAppServerClient({
      command: "definitely-missing-codex-command app-server",
      readTimeoutMs: 1_000,
      turnTimeoutMs: 1_000,
      stallTimeoutMs: 0
    });

    await expect(async () => {
      for await (const _event of client.runTurn({ workspacePath: workspace, input: "hello" })) {
        // no events expected
      }
    }).rejects.toMatchObject({ code: "process_exit" });
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

  it("replies in the same discussion thread when the latest human activity is a reply", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "symphony-agent-"));
    const config = defaultEffectiveConfig({
      workspace: { root },
      tracker: {
        kind: "linear",
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Idea"],
        terminalStates: ["Done"]
      },
      hooks: {
        afterCreate: null,
        beforeRun: null,
        afterRun: null,
        beforeRemove: null,
        timeoutMs: 1_000
      },
      planning: {
        assistantMention: "@symphony",
        assistantAuthors: ["symphony@example.com"],
        implementationPhrase: "implement",
        authorizedRequesters: null,
        planningRecordLocation: "comment"
      },
      conversation: {
        assistantAuthors: ["symphony@example.com"],
        respondToComments: true,
        respondToReplies: true,
        sameThreadReplies: true
      }
    });
    const issue: Issue = {
      id: "id-1",
      identifier: "SYM-1",
      title: "Title",
      description: null,
      priority: null,
      state: "Idea",
      branchName: null,
      url: null,
      labels: [],
      blockedBy: [],
      createdAt: null,
      updatedAt: null
    };
    const replies: Array<{ parentId: string; content: string }> = [];
    const tracker: Pick<
      IssueTrackerClient,
      "fetchIssueDiscussion" | "writePlanningRecord" | "appendIssueReply" | "fetchIssueStatesByIds"
    > = {
      fetchIssueDiscussion: async () => ({
        description: "",
        comments: [
          {
            id: "comment-1",
            body: "What should we build?",
            author: { email: "lead@example.com" },
            createdAt: new Date("2026-05-17T10:00:00Z"),
            replies: [
              {
                id: "reply-1",
                parentId: "comment-1",
                body: "Clarifying answer",
                author: { email: "lead@example.com" },
                createdAt: new Date("2026-05-17T10:05:00Z"),
                replies: []
              }
            ]
          }
        ]
      }),
      writePlanningRecord: async () => {
        throw new Error("expected threaded reply");
      },
      appendIssueReply: async (_issueId, parentId, content) => {
        replies.push({ parentId, content });
      },
      fetchIssueStatesByIds: async () => [issue]
    };
    const worker = new AgentWorker({
      config,
      tracker,
      workflowPromptTemplate: "State {{ issue.state }} latest {{ conversation.latest.body }}",
      codexClientFactory: () => ({
        runTurn: async function* () {
          yield { event: "turn_completed", timestamp: new Date(), message: "Threaded response" };
        },
        stop: async () => undefined
      })
    });

    const result = await worker.run(issue, null);

    expect(result.status).toBe("succeeded");
    expect(replies).toEqual([{ parentId: "comment-1", content: "Threaded response" }]);
  });

  it("applies workflow action blocks without posting the action syntax to Linear", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "symphony-agent-"));
    const config = defaultEffectiveConfig({
      workspace: { root },
      tracker: {
        kind: "linear",
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Idea"],
        terminalStates: ["Done"]
      },
      hooks: {
        afterCreate: null,
        beforeRun: null,
        afterRun: null,
        beforeRemove: null,
        timeoutMs: 1_000
      },
      planning: {
        assistantMention: "@symphony",
        assistantAuthors: ["symphony@example.com"],
        implementationPhrase: "implement",
        authorizedRequesters: null,
        planningRecordLocation: "comment"
      }
    });
    const issue: Issue = {
      id: "id-1",
      identifier: "SYM-1",
      title: "Title",
      description: null,
      priority: null,
      state: "Idea",
      branchName: null,
      url: null,
      labels: [],
      blockedBy: [],
      createdAt: null,
      updatedAt: null
    };
    const writes: string[] = [];
    const moves: string[] = [];
    const tracker: Pick<
      IssueTrackerClient,
      "fetchIssueDiscussion" | "writePlanningRecord" | "moveIssueToState" | "fetchIssueStatesByIds"
    > = {
      fetchIssueDiscussion: async () => ({ description: "", comments: [] }),
      writePlanningRecord: async (_issueId, content) => {
        writes.push(content);
      },
      moveIssueToState: async (_issueId, stateName) => {
        moves.push(stateName);
      },
      fetchIssueStatesByIds: async () => [issue]
    };
    const worker = new AgentWorker({
      config,
      tracker,
      workflowPromptTemplate: "Issue {{ issue.identifier }}",
      codexClientFactory: () => ({
        runTurn: async function* () {
          yield {
            event: "turn_completed",
            timestamp: new Date(),
            message: ["Understanding confirmed.", "```symphony-actions", "move_to_state: Planning", "```"].join("\n")
          };
        },
        stop: async () => undefined
      })
    });

    const result = await worker.run(issue, null);

    expect(result.status).toBe("succeeded");
    expect(writes).toEqual(["Understanding confirmed."]);
    expect(moves).toEqual(["Planning"]);
  });

  it("skips planning when the latest comment is an existing Symphony planning record", async () => {
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
      },
      planning: {
        assistantMention: "@symphony",
        implementationPhrase: "implement",
        authorizedRequesters: null,
        planningRecordLocation: "comment",
        assistantAuthors: ["symphony@example.com"]
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
    const tracker: Pick<IssueTrackerClient, "fetchIssueDiscussion" | "writePlanningRecord" | "fetchIssueStatesByIds"> = {
      fetchIssueDiscussion: async () => ({
        description: "",
        comments: [
          {
            id: "comment-1",
            body: "## Plan for SYM-1\n\nDo the thing.",
            author: { email: "symphony@example.com" },
            createdAt: new Date("2026-05-17T10:00:00Z")
          }
        ]
      }),
      writePlanningRecord: vi.fn(async () => undefined),
      fetchIssueStatesByIds: async () => [issue]
    };
    const codexClientFactory = vi.fn();
    const worker = new AgentWorker({
      config,
      tracker,
      workflowPromptTemplate: "Issue {{ issue.identifier }} mode {{ mode }}",
      codexClientFactory
    });

    const result = await worker.run(issue, null);

    expect(result).toEqual({ status: "skipped", mode: "planning", reason: "planning_record_exists" });
    expect(tracker.writePlanningRecord).not.toHaveBeenCalled();
    expect(codexClientFactory).not.toHaveBeenCalled();
  });

  it("runs implementation when a human authorization is newer than the Symphony planning record", async () => {
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
      },
      planning: {
        assistantMention: "@symphony",
        implementationPhrase: "implement",
        authorizedRequesters: null,
        planningRecordLocation: "comment",
        assistantAuthors: ["symphony@example.com"]
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
    const runTurn = vi.fn(async function* () {
      yield { event: "turn_completed" as const, timestamp: new Date(), message: "done" };
    });
    const tracker: Pick<IssueTrackerClient, "fetchIssueDiscussion" | "writePlanningRecord" | "fetchIssueStatesByIds"> = {
      fetchIssueDiscussion: async () => ({
        description: "",
        comments: [
          {
            id: "comment-1",
            body: "## Plan for SYM-1\n\nDo the thing.",
            author: { email: "symphony@example.com" },
            createdAt: new Date("2026-05-17T10:00:00Z")
          },
          {
            id: "comment-2",
            body: "@symphony implement",
            author: { email: "lead@example.com" },
            createdAt: new Date("2026-05-17T11:00:00Z")
          }
        ]
      }),
      writePlanningRecord: vi.fn(async () => undefined),
      fetchIssueStatesByIds: async () => []
    };
    const worker = new AgentWorker({
      config,
      tracker,
      workflowPromptTemplate: "Issue {{ issue.identifier }} mode {{ mode }}",
      codexClientFactory: () => ({ runTurn, stop: async () => undefined })
    });

    const result = await worker.run(issue, null);

    expect(result.status).toBe("succeeded");
    expect(result.mode).toBe("implementation");
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(tracker.writePlanningRecord).not.toHaveBeenCalled();
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
