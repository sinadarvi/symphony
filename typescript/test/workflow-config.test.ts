import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorkflow } from "../src/workflow/loader.js";
import { renderPrompt } from "../src/workflow/template.js";
import { resolveConfig, validateDispatchConfig } from "../src/config/resolve.js";

describe("workflow loading and config resolution", () => {
  it("parses YAML front matter and trims the prompt body", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-workflow-"));
    const workflowPath = path.join(dir, "WORKFLOW.md");
    await writeFile(
      workflowPath,
      [
        "---",
        "tracker:",
        "  kind: linear",
        "  project_slug: SYM",
        "---",
        "",
        "Hello {{ issue.identifier }}",
        ""
      ].join("\n")
    );

    const workflow = await loadWorkflow(workflowPath);

    expect(workflow.config).toEqual({ tracker: { kind: "linear", project_slug: "SYM" } });
    expect(workflow.promptTemplate).toBe("Hello {{ issue.identifier }}");
  });

  it("fails when front matter does not decode to a map", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-workflow-"));
    const workflowPath = path.join(dir, "WORKFLOW.md");
    await writeFile(workflowPath, ["---", "- no", "- map", "---", "Body"].join("\n"));

    await expect(loadWorkflow(workflowPath)).rejects.toMatchObject({
      code: "workflow_front_matter_not_a_map"
    });
  });

  it("uses strict prompt rendering for unknown variables", async () => {
    await expect(renderPrompt("{{ issue.missing }}", { issue: { identifier: "SYM-1" } })).rejects.toMatchObject({
      code: "template_render_error"
    });
  });

  it("applies defaults, resolves env indirection, and validates dispatch preflight", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-config-"));
    process.env.SYMPHONY_TEST_LINEAR_KEY = "linear-secret";

    const config = resolveConfig(
      {
        tracker: {
          kind: "linear",
          api_key: "$SYMPHONY_TEST_LINEAR_KEY",
          project_slug: "proj"
        },
        workspace: {
          root: "workspaces"
        },
        agent: {
          max_concurrent_agents_by_state: {
            Todo: 2,
            Broken: 0
          }
        }
      },
      path.join(dir, "WORKFLOW.md")
    );

    expect(config.tracker.apiKey).toBe("linear-secret");
    expect(config.tracker.endpoint).toBe("https://api.linear.app/graphql");
    expect(config.workspace.root).toBe(path.join(dir, "workspaces"));
    expect(config.agent.maxConcurrentAgentsByState).toEqual({ todo: 2 });
    expect(validateDispatchConfig(config)).toEqual([]);
  });

  it("rejects invalid numeric config values instead of silently defaulting them", () => {
    expect(() =>
      resolveConfig(
        {
          hooks: { timeout_ms: 0 }
        },
        "/tmp/WORKFLOW.md"
      )
    ).toThrow(/hooks.timeout_ms/);

    expect(() =>
      resolveConfig(
        {
          agent: { max_turns: -1 }
        },
        "/tmp/WORKFLOW.md"
      )
    ).toThrow(/agent.max_turns/);
  });
});
