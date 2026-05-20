import { parse as parseYaml } from "yaml";

export type WorkflowActions = {
  comment?: string;
  replyToCommentId?: string;
  moveToState?: string;
};

export type ExtractedWorkflowActions = {
  body: string;
  actions: WorkflowActions;
};

const actionBlockPattern = /```symphony-actions\s*\n([\s\S]*?)\n```/g;

export function extractWorkflowActions(content: string): ExtractedWorkflowActions {
  const actions: WorkflowActions = {};
  let body = content;

  for (const match of content.matchAll(actionBlockPattern)) {
    const parsed = parseActionBlock(match[1]);
    if (parsed.comment) actions.comment = parsed.comment;
    if (parsed.reply_to_comment_id) actions.replyToCommentId = parsed.reply_to_comment_id;
    if (parsed.move_to_state) actions.moveToState = parsed.move_to_state;
    body = body.replace(match[0], "");
  }

  return { body: body.trim(), actions };
}

function parseActionBlock(content: string): { comment?: string; reply_to_comment_id?: string; move_to_state?: string } {
  const parsed = parseYaml(content) as unknown;
  if (!isRecord(parsed)) return {};
  return {
    comment: stringOrUndefined(parsed.comment),
    reply_to_comment_id: stringOrUndefined(parsed.reply_to_comment_id),
    move_to_state: stringOrUndefined(parsed.move_to_state)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
