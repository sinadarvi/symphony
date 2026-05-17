import type { PlanningRecordLocation } from "../config/schema.js";

export type BlockerRef = {
  id: string | null;
  identifier: string | null;
  state: string | null;
};

export type Issue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branchName: string | null;
  url: string | null;
  labels: string[];
  blockedBy: BlockerRef[];
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type DiscussionAuthor = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  username?: string | null;
};

export type DiscussionComment = {
  id: string;
  body: string;
  author?: DiscussionAuthor | null;
  createdAt?: Date | null;
};

export type IssueDiscussion = {
  description: string | null;
  comments: DiscussionComment[];
};

export interface IssueTrackerClient {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<Issue[]>;
  fetchIssueDiscussion(issueId: string): Promise<IssueDiscussion>;
  writePlanningRecord(issueId: string, content: string, location: PlanningRecordLocation): Promise<void>;
  appendIssueComment(issueId: string, content: string): Promise<void>;
}
