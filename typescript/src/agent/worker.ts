import type { EffectiveConfig } from "../config/schema.js";
import { renderPrompt } from "../workflow/template.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { authorizeImplementation } from "../planning/authorization.js";
import {
  descriptionHasPlanningRecord,
  formatPlanningRecord,
  latestCommentIsPlanningRecord,
  latestDiscussionActivity
} from "../planning/records.js";
import type { CodexRuntimeEvent } from "../codex/events.js";
import type { CodexSession } from "../codex/protocol.js";
import { CodexAppServerClient } from "../codex/app-server-client.js";
import type { Issue, IssueDiscussion, IssueTrackerClient } from "../tracker/types.js";
import { extractWorkflowActions, type WorkflowActions } from "../workflow/actions.js";

export type AgentWorkerResult = {
  status: "succeeded" | "failed" | "skipped";
  mode: "planning" | "implementation";
  reason?: "planning_record_exists";
  error?: unknown;
};

export type AgentWorkerOptions = {
  config: EffectiveConfig;
  tracker: Pick<IssueTrackerClient, "fetchIssueDiscussion" | "writePlanningRecord" | "fetchIssueStatesByIds"> &
    Partial<Pick<IssueTrackerClient, "appendIssueReply" | "appendIssueComment" | "moveIssueToState">>;
  workflowPromptTemplate: string;
  codexClientFactory?: () => CodexSession;
  onEvent?: (event: CodexRuntimeEvent) => void;
};

export class AgentWorker {
  private readonly workspaceManager: WorkspaceManager;

  constructor(private readonly options: AgentWorkerOptions) {
    this.workspaceManager = new WorkspaceManager(options.config);
  }

  async run(issue: Issue, attempt: number | null): Promise<AgentWorkerResult> {
    let workspacePath: string | null = null;
    let mode: "planning" | "implementation" = "planning";
    let client: CodexSession | null = null;

    try {
      const discussion = await this.options.tracker.fetchIssueDiscussion(issue.id);
      const latestActivity = latestDiscussionActivity(discussion);
      if (
        this.options.config.planning.planningRecordLocation === "comment" &&
        latestCommentIsPlanningRecord(issue.identifier, discussion, this.options.config.planning)
      ) {
        return { status: "skipped", mode: "planning", reason: "planning_record_exists" };
      }
      const authorization = authorizeImplementation(discussion.comments, this.options.config.planning);
      mode = authorization.authorized ? "implementation" : "planning";
      if (
        mode === "planning" &&
        this.options.config.planning.planningRecordLocation === "description" &&
        descriptionHasPlanningRecord(issue.identifier, discussion)
      ) {
        return { status: "skipped", mode: "planning", reason: "planning_record_exists" };
      }

      const workspace = await this.workspaceManager.ensureForIssue(issue.identifier);
      workspacePath = workspace.path;
      await this.workspaceManager.runBeforeRun(workspacePath);

      const prompt = await renderPrompt(this.options.workflowPromptTemplate, {
        issue,
        attempt,
        mode,
        planning: {
          authorization,
          discussion
        },
        workflowStates: this.options.config.workflowStates,
        conversation: {
          ...this.options.config.conversation,
          discussion,
          latest: latestActivity
            ? {
                ...latestActivity,
                parentId: latestActivity.parentId ?? null,
                author: latestActivity.author ?? {}
              }
            : null
        }
      });

      client = this.options.codexClientFactory?.() ?? new CodexAppServerClient(this.options.config.codex);
      let planningRecord = "";
      let turns = 0;

      while (turns < this.options.config.agent.maxTurns) {
        turns += 1;
        const input = turns === 1 ? prompt : `Continue working on ${issue.identifier}. Do not repeat the initial prompt.`;
        for await (const event of client.runTurn({ workspacePath, input, title: `${issue.identifier}: ${issue.title}` })) {
          this.options.onEvent?.(event);
          if (mode === "planning" && event.message) planningRecord = event.message;
        }

        if (mode === "planning") {
          await this.writePlanningResponse(issue.id, discussion, planningRecord);
          break;
        }

        const [latest] = await this.options.tracker.fetchIssueStatesByIds([issue.id]);
        if (!latest || !this.options.config.tracker.activeStates.map((state) => state.toLowerCase()).includes(latest.state.toLowerCase())) break;
      }

      return { status: "succeeded", mode };
    } catch (error) {
      return { status: "failed", mode, error };
    } finally {
      await client?.stop();
      if (workspacePath) await this.workspaceManager.runAfterRun(workspacePath);
    }
  }

  private async writePlanningResponse(issueId: string, discussion: IssueDiscussion, content: string): Promise<void> {
    const extracted = extractWorkflowActions(content);
    const formatted = formatPlanningRecord(extracted.actions.comment ?? extracted.body);
    const latestActivity = latestDiscussionActivity(discussion);
    const parentId = extracted.actions.replyToCommentId ?? latestActivity?.parentId ?? null;
    if (
      formatted &&
      parentId &&
      this.options.config.conversation.sameThreadReplies &&
      this.options.config.conversation.respondToReplies &&
      this.options.config.planning.planningRecordLocation === "comment" &&
      this.options.tracker.appendIssueReply
    ) {
      await this.options.tracker.appendIssueReply(issueId, parentId, formatted);
      await this.applyWorkflowActions(issueId, extracted.actions);
      return;
    }

    await this.options.tracker.writePlanningRecord(issueId, formatted, this.options.config.planning.planningRecordLocation);
    await this.applyWorkflowActions(issueId, extracted.actions);
  }

  private async applyWorkflowActions(issueId: string, actions: WorkflowActions): Promise<void> {
    if (actions.moveToState) await this.options.tracker.moveIssueToState?.(issueId, actions.moveToState);
  }
}
