import type { DiscussionAuthor, DiscussionComment } from "../tracker/types.js";

export type PlanningAuthorizationConfig = {
  assistantMention: string;
  implementationPhrase: string;
  authorizedRequesters: string[] | null;
};

export type AuthorizationResult =
  | { authorized: true; requester: string | null; commentId: string }
  | { authorized: false; requester?: null; commentId?: undefined };

export function authorizeImplementation(
  comments: DiscussionComment[],
  config: PlanningAuthorizationConfig
): AuthorizationResult {
  const mention = normalizeDiscussionText(config.assistantMention);
  const phrase = normalizeDiscussionText(config.implementationPhrase);
  const allowed = config.authorizedRequesters?.map((requester) => requester.toLowerCase()) ?? null;

  for (const comment of flattenDiscussionComments(comments)) {
    const body = normalizeDiscussionText(comment.body);
    if (!body.includes(mention) || !body.includes(phrase)) continue;

    const requester = requesterRef(comment.author);
    if (allowed && (!requester || !allowed.includes(requester.toLowerCase()))) continue;

    return { authorized: true, requester, commentId: comment.id };
  }

  return { authorized: false };
}

export function flattenDiscussionComments(comments: DiscussionComment[]): DiscussionComment[] {
  return comments.flatMap((comment) => [comment, ...flattenDiscussionComments(comment.replies ?? [])]);
}

export function normalizeDiscussionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/<@([^>]+)>/g, "@$1")
    .replace(/\s+/g, " ")
    .trim();
}

function requesterRef(author?: DiscussionAuthor | null): string | null {
  return author?.email ?? author?.username ?? author?.name ?? author?.id ?? null;
}
