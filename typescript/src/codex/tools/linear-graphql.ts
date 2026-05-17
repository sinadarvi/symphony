export type LinearGraphqlToolConfig = {
  endpoint: string;
  apiKey: string | null;
  fetchImpl?: typeof fetch;
};

export type LinearGraphqlToolResult = {
  success: boolean;
  response?: unknown;
  error?: string;
};

export function createLinearGraphqlTool(config: LinearGraphqlToolConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;
  return async function linearGraphql(input: unknown): Promise<LinearGraphqlToolResult> {
    if (!config.apiKey) return { success: false, error: "missing Linear API key" };

    const parsed = parseInput(input);
    if (!parsed.ok) return { success: false, error: parsed.error };
    if (operationCount(parsed.query) !== 1) return { success: false, error: "linear_graphql requires exactly one GraphQL operation" };

    try {
      const response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: config.apiKey
        },
        body: JSON.stringify({ query: parsed.query, variables: parsed.variables ?? {} })
      });
      const body = (await response.json()) as unknown;
      if (!response.ok) return { success: false, response: body, error: `Linear returned HTTP ${response.status}` };
      if (hasGraphqlErrors(body)) return { success: false, response: body };
      return { success: true, response: body };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

function parseInput(input: unknown): { ok: true; query: string; variables?: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof input === "string" && input.trim() !== "") return { ok: true, query: input };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "input must be a GraphQL query string or object" };
  const record = input as Record<string, unknown>;
  if (typeof record.query !== "string" || record.query.trim() === "") return { ok: false, error: "query must be a non-empty string" };
  if (record.variables !== undefined && (typeof record.variables !== "object" || record.variables === null || Array.isArray(record.variables))) {
    return { ok: false, error: "variables must be an object" };
  }
  return { ok: true, query: record.query, variables: record.variables as Record<string, unknown> | undefined };
}

function operationCount(query: string): number {
  const withoutComments = query.replace(/#[^\n]*/g, " ");
  return (withoutComments.match(/\b(query|mutation|subscription)\b/g) ?? []).length || (withoutComments.includes("{") ? 1 : 0);
}

function hasGraphqlErrors(value: unknown): boolean {
  return typeof value === "object" && value !== null && Array.isArray((value as Record<string, unknown>).errors);
}
