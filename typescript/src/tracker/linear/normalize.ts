import { parseOptionalDate } from "../../shared/time.js";
import type { BlockerRef, DiscussionComment, Issue } from "../types.js";

export function normalizeLinearIssue(raw: Record<string, unknown>): Issue {
  const state = record(raw.state);
  return {
    id: stringValue(raw.id),
    identifier: stringValue(raw.identifier),
    title: stringValue(raw.title),
    description: nullableString(raw.description),
    priority: Number.isInteger(raw.priority) ? (raw.priority as number) : null,
    state: stringValue(state.name),
    branchName: nullableString(raw.branchName),
    url: nullableString(raw.url),
    labels: normalizeLabels(raw.labels),
    blockedBy: normalizeBlockers(raw.inverseRelations),
    createdAt: parseOptionalDate(raw.createdAt),
    updatedAt: parseOptionalDate(raw.updatedAt)
  };
}

export function normalizeLinearComment(raw: Record<string, unknown>): DiscussionComment {
  const user = record(raw.user);
  return {
    id: stringValue(raw.id),
    parentId: nullableString(raw.parentId),
    body: stringValue(raw.body),
    createdAt: parseOptionalDate(raw.createdAt),
    author: {
      id: nullableString(user.id),
      name: nullableString(user.name) ?? nullableString(user.displayName),
      email: nullableString(user.email),
      username: nullableString(user.displayName)
    },
    replies: nodes(raw.children).map(normalizeLinearComment)
  };
}

function normalizeLabels(rawLabels: unknown): string[] {
  return nodes(rawLabels)
    .map((label) => nullableString(label.name)?.toLowerCase())
    .filter((label): label is string => Boolean(label));
}

function normalizeBlockers(rawRelations: unknown): BlockerRef[] {
  return nodes(rawRelations)
    .filter((relation) => relation.type === "blocks")
    .map((relation) => {
      const issue = record(relation.issue);
      const state = record(issue.state);
      return {
        id: nullableString(issue.id),
        identifier: nullableString(issue.identifier),
        state: nullableString(state.name)
      };
    });
}

function nodes(value: unknown): Record<string, unknown>[] {
  const maybeNodes = record(value).nodes;
  return Array.isArray(maybeNodes)
    ? maybeNodes.filter((node): node is Record<string, unknown> => typeof node === "object" && node !== null)
    : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
