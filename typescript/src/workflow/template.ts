import { Liquid } from "liquidjs";
import { SymphonyError } from "../shared/errors.js";

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true
});

export const defaultPromptTemplate = `You are working on a Linear issue.

Identifier: {{ issue.identifier }}
Title: {{ issue.title }}

Body:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}`;

export async function renderPrompt(template: string, context: Record<string, unknown>): Promise<string> {
  const source = template.trim() === "" ? defaultPromptTemplate : template;
  try {
    return await engine.parseAndRender(source, context);
  } catch (cause) {
    throw new SymphonyError("template_render_error", "Failed to render workflow prompt", { cause });
  }
}
