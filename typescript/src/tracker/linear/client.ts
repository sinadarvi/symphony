import { SymphonyError } from "../../shared/errors.js";
import type { PlanningRecordLocation } from "../../config/schema.js";
import type { Issue, IssueDiscussion, IssueTrackerClient } from "../types.js";
import {
  candidateIssuesQuery,
  createCommentMutation,
  issueDiscussionQuery,
  issuesByStatesQuery,
  issueStatesByIdsQuery,
  updateIssueDescriptionMutation
} from "./queries.js";
import { normalizeLinearComment, normalizeLinearIssue } from "./normalize.js";

export type LinearClientConfig = {
  endpoint: string;
  apiKey: string;
  projectSlug: string;
  activeStates: string[];
  terminalStates: string[];
  pageSize?: number;
};

export class LinearClient implements IssueTrackerClient {
  private readonly pageSize: number;
  private readonly maxAttempts = 3;

  constructor(
    private readonly config: LinearClientConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.pageSize = config.pageSize ?? 50;
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    return this.fetchPagedIssues(candidateIssuesQuery, {
      projectSlug: this.config.projectSlug,
      activeStates: this.config.activeStates
    });
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    return this.fetchPagedIssues(issuesByStatesQuery, {
      projectSlug: this.config.projectSlug,
      states
    });
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    if (ids.length === 0) return [];
    const payload = await this.graphql(issueStatesByIdsQuery, { ids });
    return issueNodes(payload).map(normalizeLinearIssue);
  }

  async fetchIssueDiscussion(issueId: string): Promise<IssueDiscussion> {
    const payload = await this.graphql(issueDiscussionQuery, { id: issueId });
    const issue = record(record(payload.data).issue);
    return {
      description: nullableString(issue.description),
      comments: nodes(record(issue.comments)).map(normalizeLinearComment)
    };
  }

  async writePlanningRecord(issueId: string, content: string, location: PlanningRecordLocation): Promise<void> {
    if (location === "comment") {
      await this.appendIssueComment(issueId, content);
      return;
    }
    await this.graphql(updateIssueDescriptionMutation, { id: issueId, description: content });
  }

  async appendIssueComment(issueId: string, content: string): Promise<void> {
    await this.graphql(createCommentMutation, { issueId, body: content });
  }

  private async fetchPagedIssues(query: string, variables: Record<string, unknown>): Promise<Issue[]> {
    const issues: Issue[] = [];
    let after: string | null = null;

    for (;;) {
      const payload = await this.graphql(query, { ...variables, after, first: this.pageSize });
      const issuesPayload = record(record(payload.data).issues);
      issues.push(...nodes(issuesPayload).map(normalizeLinearIssue));
      const pageInfo = record(issuesPayload.pageInfo);
      const hasNextPage = pageInfo.hasNextPage === true;
      const endCursor = nullableString(pageInfo.endCursor);
      if (!hasNextPage) return issues;
      if (!endCursor) throw new SymphonyError("linear_missing_end_cursor", "Linear pagination reported next page without endCursor");
      after = endCursor;
    }
  }

  private async graphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    let lastError: SymphonyError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.graphqlAttempt(query, variables);
      } catch (error) {
        if (!(error instanceof SymphonyError) || !isRetryableLinearError(error) || attempt === this.maxAttempts) throw error;
        lastError = error;
        await sleep(retryDelayMs(attempt));
      }
    }

    throw lastError ?? new SymphonyError("linear_api_request", "Linear API request failed");
  }

  private async graphqlAttempt(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: this.config.apiKey
        },
        body: JSON.stringify({ query, variables })
      });
    } catch (cause) {
      throw new SymphonyError("linear_api_request", "Linear API request failed", { cause });
    }

    const rawBody = await response.text();

    if (!response.ok) {
      throw new SymphonyError("linear_api_status", `Linear API returned status ${response.status}`, {
        context: { status: response.status, body: truncate(rawBody), retryable: isRetryableStatus(response.status) }
      });
    }

    const payload = parseJson(rawBody);
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new SymphonyError("linear_graphql_errors", "Linear GraphQL response included errors", { context: { errors: payload.errors } });
    }
    return payload;
  }
}

function issueNodes(payload: Record<string, unknown>): Record<string, unknown>[] {
  return nodes(record(record(payload.data).issues));
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

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseJson(body: string): Record<string, unknown> {
  try {
    const payload = JSON.parse(body) as unknown;
    return record(payload);
  } catch (cause) {
    throw new SymphonyError("linear_unknown_payload", "Linear API returned invalid JSON", { cause, context: { body: truncate(body) } });
  }
}

function truncate(value: string, maxLength = 4_000): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isRetryableLinearError(error: SymphonyError): boolean {
  if (error.code === "linear_api_request") return true;
  if (error.code !== "linear_api_status") return false;
  const status = error.context?.status;
  return typeof status === "number" && isRetryableStatus(status);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
  return attempt === 1 ? 500 : 1_500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
