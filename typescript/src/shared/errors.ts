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
