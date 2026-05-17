import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { SymphonyError } from "../shared/errors.js";

export type WorkflowDefinition = {
  config: Record<string, unknown>;
  promptTemplate: string;
};

export async function loadWorkflow(workflowPath: string): Promise<WorkflowDefinition> {
  let content: string;
  try {
    content = await readFile(workflowPath, "utf8");
  } catch (cause) {
    throw new SymphonyError("missing_workflow_file", `Missing WORKFLOW.md at ${workflowPath}`, {
      cause,
      context: { workflowPath }
    });
  }

  return parseWorkflow(content);
}

export function parseWorkflow(content: string): WorkflowDefinition {
  const { frontMatter, body } = splitFrontMatter(content);
  let config: unknown = {};

  if (frontMatter.trim() !== "") {
    try {
      config = parseYaml(frontMatter);
    } catch (cause) {
      throw new SymphonyError("workflow_parse_error", "Failed to parse workflow front matter", { cause });
    }
  }

  if (config == null) config = {};
  if (!isPlainRecord(config)) {
    throw new SymphonyError("workflow_front_matter_not_a_map", "Workflow front matter must decode to a map");
  }

  return {
    config,
    promptTemplate: body.trim()
  };
}

function splitFrontMatter(content: string): { frontMatter: string; body: string } {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return { frontMatter: "", body: content };

  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex === -1) {
    return { frontMatter: lines.slice(1).join("\n"), body: "" };
  }

  return {
    frontMatter: lines.slice(1, closingIndex).join("\n"),
    body: lines.slice(closingIndex + 1).join("\n")
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
