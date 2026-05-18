import { describe, expect, it, vi } from "vitest";
import { defaultEffectiveConfig } from "../src/config/defaults.js";
import { formatErrorReport, SymphonyError } from "../src/shared/errors.js";
import { LinearClient } from "../src/tracker/linear/client.js";
import { normalizeLinearIssue } from "../src/tracker/linear/normalize.js";
import { createInitialState } from "../src/orchestrator/state.js";
import { eligibleIssues, sortIssuesForDispatch } from "../src/orchestrator/dispatch.js";
import { scheduleRetryDelayMs } from "../src/orchestrator/retry.js";
import { reconcileRunning } from "../src/orchestrator/reconcile.js";
import { Scheduler } from "../src/orchestrator/scheduler.js";
import type { Issue, IssueTrackerClient } from "../src/tracker/types.js";

const baseIssue = (overrides: Partial<Issue> = {}): Issue => ({
  id: overrides.id ?? "id-1",
  identifier: overrides.identifier ?? "SYM-1",
  title: overrides.title ?? "Title",
  description: overrides.description ?? null,
  priority: overrides.priority ?? null,
  state: overrides.state ?? "Todo",
  branchName: overrides.branchName ?? null,
  url: overrides.url ?? null,
  labels: overrides.labels ?? [],
  blockedBy: overrides.blockedBy ?? [],
  createdAt: overrides.createdAt ?? null,
  updatedAt: overrides.updatedAt ?? null
});

describe("Linear normalization and orchestration", () => {
  it("normalizes Linear issues including labels, blockers, and dates", () => {
    const issue = normalizeLinearIssue({
      id: "id",
      identifier: "SYM-1",
      title: "Build",
      description: null,
      priority: 2,
      state: { name: "Todo" },
      branchName: "sym-1-build",
      url: "https://linear.app/issue/SYM-1",
      labels: { nodes: [{ name: "Backend" }, { name: "P0" }] },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "bad",
      inverseRelations: {
        nodes: [{ type: "blocks", issue: { id: "b1", identifier: "SYM-0", state: { name: "In Progress" } } }]
      }
    });

    expect(issue.labels).toEqual(["backend", "p0"]);
    expect(issue.blockedBy).toEqual([{ id: "b1", identifier: "SYM-0", state: "In Progress" }]);
    expect(issue.createdAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(issue.updatedAt).toBeNull();
  });

  it("paginates Linear candidate issue queries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            issues: {
              nodes: [linearIssue("id-1", "SYM-1")],
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            issues: {
              nodes: [linearIssue("id-2", "SYM-2")],
              pageInfo: { hasNextPage: false, endCursor: null }
            }
          }
        })
      });
    const client = new LinearClient(
      {
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo"],
        terminalStates: ["Done"]
      },
      fetchImpl as unknown as typeof fetch
    );

    const issues = await client.fetchCandidateIssues();

    expect(issues.map((issue) => issue.identifier)).toEqual(["SYM-1", "SYM-2"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fetches Linear comments with replies as discussion threads", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: {
          issue: {
            description: "Issue body",
            comments: {
              nodes: [
                {
                  id: "comment-1",
                  body: "Top level",
                  createdAt: "2026-05-17T10:00:00.000Z",
                  user: { id: "u1", name: "User", email: "user@example.com", displayName: "user" },
                  children: {
                    nodes: [
                      {
                        id: "reply-1",
                        parentId: "comment-1",
                        body: "Reply",
                        createdAt: "2026-05-17T10:05:00.000Z",
                        user: { id: "u2", name: "Symphony", email: "symphony@example.com", displayName: "symphony" }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      })
    });
    const client = new LinearClient(
      {
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo"],
        terminalStates: ["Done"]
      },
      fetchImpl as unknown as typeof fetch
    );

    const discussion = await client.fetchIssueDiscussion("issue-1");

    expect(discussion.comments).toHaveLength(1);
    expect(discussion.comments[0].replies).toEqual([
      {
        id: "reply-1",
        parentId: "comment-1",
        body: "Reply",
        createdAt: new Date("2026-05-17T10:05:00.000Z"),
        author: { id: "u2", name: "Symphony", email: "symphony@example.com", username: "symphony" },
        replies: []
      }
    ]);
  });

  it("formats Linear request failures with code and nested causes", async () => {
    const rootCause = new Error("getaddrinfo ENOTFOUND api.linear.app");
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause: rootCause }));
    const client = new LinearClient(
      {
        endpoint: "https://api.linear.app/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo"],
        terminalStates: ["Done"]
      },
      fetchImpl as unknown as typeof fetch
    );

    await expect(client.fetchCandidateIssues()).rejects.toMatchObject({ code: "linear_api_request" });

    try {
      await client.fetchCandidateIssues();
    } catch (error) {
      expect(formatErrorReport(error)).toContain("code=linear_api_request");
      expect(formatErrorReport(error)).toContain("cause=TypeError: fetch failed");
      expect(formatErrorReport(error)).toContain("cause=getaddrinfo ENOTFOUND api.linear.app");
    }
  });

  it("includes Linear HTTP error response bodies in formatted context", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "{\"errors\":[{\"message\":\"Authentication required\"}]}"
    });
    const client = new LinearClient(
      {
        endpoint: "https://api.linear.app/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo"],
        terminalStates: ["Done"]
      },
      fetchImpl as unknown as typeof fetch
    );

    await expect(client.fetchCandidateIssues()).rejects.toThrow(SymphonyError);

    try {
      await client.fetchCandidateIssues();
    } catch (error) {
      const report = formatErrorReport(error);
      expect(report).toContain("code=linear_api_status");
      expect(report).toContain("status\":401");
      expect(report).toContain("Authentication required");
    }
  });

  it("can post Linear replies and move issues by state name", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { commentCreate: { success: true } } })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            issue: {
              team: {
                states: {
                  nodes: [
                    { id: "state-1", name: "Todo" },
                    { id: "state-2", name: "In Progress" }
                  ]
                }
              }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { issueUpdate: { success: true } } })
      });
    const client = new LinearClient(
      {
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo"],
        terminalStates: ["Done"]
      },
      fetchImpl as unknown as typeof fetch
    );

    await client.appendIssueReply("issue-1", "comment-1", "Threaded response");
    await client.moveIssueToState("issue-1", "In Progress");

    const replyRequest = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(replyRequest.variables).toEqual({ issueId: "issue-1", parentId: "comment-1", body: "Threaded response" });
    const updateRequest = JSON.parse(fetchImpl.mock.calls[2][1].body as string);
    expect(updateRequest.variables).toEqual({ id: "issue-1", stateId: "state-2" });
  });

  it("sorts and filters dispatch candidates with blockers and concurrency limits", () => {
    const config = defaultEffectiveConfig({
      tracker: {
        kind: "linear",
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo", "In Progress"],
        terminalStates: ["Done"]
      },
      agent: {
        maxConcurrentAgents: 2,
        maxTurns: 20,
        maxRetryBackoffMs: 300_000,
        maxConcurrentAgentsByState: { todo: 1 }
      }
    });
    const state = createInitialState(config);
    const issues = [
      baseIssue({ id: "2", identifier: "SYM-2", priority: 1, createdAt: new Date("2026-01-02") }),
      baseIssue({ id: "1", identifier: "SYM-1", priority: 1, createdAt: new Date("2026-01-01") }),
      baseIssue({
        id: "3",
        identifier: "SYM-3",
        priority: 0,
        blockedBy: [{ id: "blocker", identifier: "SYM-0", state: "In Progress" }]
      })
    ];

    const sorted = sortIssuesForDispatch(issues);
    const eligible = eligibleIssues(sorted, state, config);

    expect(sorted.map((issue) => issue.identifier)).toEqual(["SYM-3", "SYM-1", "SYM-2"]);
    expect(eligible.map((issue) => issue.identifier)).toEqual(["SYM-1"]);
  });

  it("computes fixed continuation and capped exponential retry delays", () => {
    expect(scheduleRetryDelayMs({ attempt: 1, cleanExit: true, maxRetryBackoffMs: 300_000 })).toBe(1_000);
    expect(scheduleRetryDelayMs({ attempt: 1, cleanExit: false, maxRetryBackoffMs: 15_000 })).toBe(10_000);
    expect(scheduleRetryDelayMs({ attempt: 5, cleanExit: false, maxRetryBackoffMs: 15_000 })).toBe(15_000);
  });

  it("reconciles running issues that moved to terminal states", async () => {
    const config = defaultEffectiveConfig({
      tracker: {
        kind: "linear",
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo"],
        terminalStates: ["Done"]
      }
    });
    const state = createInitialState(config);
    const stop = vi.fn();
    const cleanup = vi.fn();
    state.running.set("id-1", {
      issue: baseIssue(),
      startedAt: Date.now() - 1_000,
      attempt: null,
      status: "StreamingTurn",
      stop
    });
    state.claimed.add("id-1");
    const tracker: Pick<IssueTrackerClient, "fetchIssueStatesByIds"> = {
      fetchIssueStatesByIds: async () => [baseIssue({ state: "Done" })]
    };

    await reconcileRunning(state, config, tracker, { cleanupWorkspace: cleanup });

    expect(stop).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith("SYM-1");
    expect(state.running.has("id-1")).toBe(false);
    expect(state.claimed.has("id-1")).toBe(false);
  });

  it("releases running issues missing from reconciliation results", async () => {
    const config = defaultEffectiveConfig({
      tracker: {
        kind: "linear",
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo"],
        terminalStates: ["Done"]
      }
    });
    const state = createInitialState(config);
    const stop = vi.fn();
    state.running.set("id-1", {
      issue: baseIssue(),
      startedAt: Date.now() - 1_000,
      attempt: null,
      status: "StreamingTurn",
      stop
    });
    state.claimed.add("id-1");
    const tracker: Pick<IssueTrackerClient, "fetchIssueStatesByIds"> = {
      fetchIssueStatesByIds: async () => []
    };

    await reconcileRunning(state, config, tracker, { cleanupWorkspace: vi.fn() });

    expect(stop).toHaveBeenCalled();
    expect(state.running.has("id-1")).toBe(false);
    expect(state.claimed.has("id-1")).toBe(false);
  });

  it("dispatches selected workers without waiting for long-running worker promises", async () => {
    const config = defaultEffectiveConfig({
      tracker: {
        kind: "linear",
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo"],
        terminalStates: ["Done"]
      },
      agent: {
        maxConcurrentAgents: 2,
        maxTurns: 20,
        maxRetryBackoffMs: 300_000,
        maxConcurrentAgentsByState: {}
      }
    });
    const state = createInitialState(config);
    const tracker: Pick<IssueTrackerClient, "fetchCandidateIssues"> = {
      fetchCandidateIssues: async () => [baseIssue({ id: "id-1", identifier: "SYM-1" }), baseIssue({ id: "id-2", identifier: "SYM-2" })]
    };
    const started: string[] = [];
    const scheduler = new Scheduler(state, config, tracker, (issue) => {
      started.push(issue.identifier);
      return new Promise(() => undefined);
    });

    const selected = await Promise.race([
      scheduler.tick(),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 50))
    ]);

    expect(selected).not.toBe("timed-out");
    expect(started).toEqual(["SYM-1", "SYM-2"]);
    expect([...state.claimed]).toEqual(["id-1", "id-2"]);
  });

  it("releases a claim when worker dispatch fails before it can own the issue", async () => {
    const config = defaultEffectiveConfig({
      tracker: {
        kind: "linear",
        endpoint: "https://linear.test/graphql",
        apiKey: "secret",
        projectSlug: "proj",
        activeStates: ["Todo"],
        terminalStates: ["Done"]
      }
    });
    const state = createInitialState(config);
    const tracker: Pick<IssueTrackerClient, "fetchCandidateIssues"> = {
      fetchCandidateIssues: async () => [baseIssue({ id: "id-1", identifier: "SYM-1" })]
    };
    const scheduler = new Scheduler(state, config, tracker, () => Promise.reject(new Error("boom")));

    await scheduler.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.claimed.has("id-1")).toBe(false);
  });
});

function linearIssue(id: string, identifier: string): Record<string, unknown> {
  return {
    id,
    identifier,
    title: "Title",
    description: null,
    priority: null,
    state: { name: "Todo" },
    labels: { nodes: [] },
    inverseRelations: { nodes: [] },
    createdAt: null,
    updatedAt: null
  };
}
