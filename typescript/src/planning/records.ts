import type { DiscussionAuthor, IssueDiscussion } from "../tracker/types.js";
import { flattenDiscussionComments } from "./authorization.js";

export function formatPlanningRecord(content: string): string {
  return content.trim();
}

export type PlanningRecordDetectionConfig = {
  assistantAuthors: string[] | null;
};

export function latestCommentIsPlanningRecord(
  issueIdentifier: string,
  discussion: IssueDiscussion,
  config: PlanningRecordDetectionConfig
): boolean {
  const latest = latestDiscussionActivity(discussion);
  if (!latest) return false;

  return isAssistantAuthor(latest.author, config.assistantAuthors) || hasPlanningRecordMarker(issueIdentifier, latest.body);
}

export function descriptionHasPlanningRecord(issueIdentifier: string, discussion: IssueDiscussion): boolean {
  return hasPlanningRecordMarker(issueIdentifier, discussion.description ?? "");
}

export function latestDiscussionActivity(discussion: IssueDiscussion) {
  return latestComment(flattenDiscussionComments(discussion.comments));
}

function latestComment<T extends { createdAt?: Date | null }>(comments: T[]): T | null {
  if (comments.length === 0) return null;

  return comments.reduce((latest, comment) => {
    const latestTime = latest.createdAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const commentTime = comment.createdAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    return commentTime >= latestTime ? comment : latest;
  });
}

function isAssistantAuthor(author: DiscussionAuthor | null | undefined, assistantAuthors: string[] | null): boolean {
  if (!assistantAuthors || assistantAuthors.length === 0) return false;

  const authorRefs = [author?.email, author?.username, author?.name, author?.id]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => normalizeAuthorRef(value));
  const assistantRefs = assistantAuthors.map(normalizeAuthorRef);

  return authorRefs.some((authorRef) => assistantRefs.includes(authorRef));
}

function hasPlanningRecordMarker(issueIdentifier: string, content: string): boolean {
  const normalized = content.toLowerCase();
  return normalized.includes(`## plan for ${issueIdentifier.toLowerCase()}`);
}

function normalizeAuthorRef(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}
