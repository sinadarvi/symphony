export type SymphonyErrorCode =
  | "missing_workflow_file"
  | "workflow_parse_error"
  | "workflow_front_matter_not_a_map"
  | "template_parse_error"
  | "template_render_error"
  | "unsupported_tracker_kind"
  | "missing_tracker_api_key"
  | "missing_tracker_project_slug"
  | "linear_api_request"
  | "linear_api_status"
  | "linear_graphql_errors"
  | "linear_unknown_payload"
  | "linear_missing_end_cursor"
  | "tracker_write_failed"
  | "workspace_path_escape"
  | "hook_failed"
  | "hook_timeout"
  | "invalid_workspace_cwd"
  | "response_timeout"
  | "turn_timeout"
  | "process_exit"
  | "turn_failed"
  | "turn_cancelled"
  | "turn_input_required";

export class SymphonyError extends Error {
  readonly code: SymphonyErrorCode | string;
  readonly context?: Record<string, unknown>;

  constructor(code: SymphonyErrorCode | string, message: string, options: { cause?: unknown; context?: Record<string, unknown> } = {}) {
    super(message, { cause: options.cause });
    this.name = "SymphonyError";
    this.code = code;
    this.context = options.context;
  }
}

export function toSymphonyError(error: unknown, code = "unknown_error"): SymphonyError {
  if (error instanceof SymphonyError) return error;
  if (error instanceof Error) return new SymphonyError(code, error.message, { cause: error });
  return new SymphonyError(code, String(error));
}

export function formatErrorReport(error: unknown): string {
  const lines = [error instanceof Error ? error.message : String(error)];

  if (error instanceof SymphonyError) {
    lines.push(`code=${error.code}`);
    if (error.context && Object.keys(error.context).length > 0) {
      lines.push(`context=${JSON.stringify(sanitizeForLog(error.context))}`);
    }
  }

  let cause = errorCause(error);
  let depth = 0;
  while (cause !== undefined && depth < 5) {
    lines.push(`cause=${formatCause(cause)}`);
    cause = errorCause(cause);
    depth += 1;
  }

  return lines.join("\n");
}

function formatCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.name && cause.name !== "Error" ? `${cause.name}: ${cause.message}` : cause.message;
  }
  return String(cause);
}

function errorCause(value: unknown): unknown {
  return typeof value === "object" && value !== null && "cause" in value ? (value as { cause?: unknown }).cause : undefined;
}

function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      isSecretKey(key) ? "[redacted]" : sanitizeForLog(nestedValue)
    ])
  );
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("token") || normalized.includes("apikey") || normalized.includes("api_key") || normalized.includes("authorization");
}
