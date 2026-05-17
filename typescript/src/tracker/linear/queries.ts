export const candidateIssuesQuery = `
query SymphonyCandidateIssues($projectSlug: String!, $activeStates: [String!], $after: String, $first: Int!) {
  issues(
    first: $first
    after: $after
    filter: { project: { slugId: { eq: $projectSlug } }, state: { name: { in: $activeStates } } }
  ) {
    nodes {
      id
      identifier
      title
      description
      priority
      branchName
      url
      createdAt
      updatedAt
      state { name }
      labels { nodes { name } }
      inverseRelations { nodes { type issue { id identifier state { name } } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const issuesByStatesQuery = `
query SymphonyIssuesByStates($projectSlug: String!, $states: [String!], $after: String, $first: Int!) {
  issues(
    first: $first
    after: $after
    filter: { project: { slugId: { eq: $projectSlug } }, state: { name: { in: $states } } }
  ) {
    nodes { id identifier title description priority branchName url createdAt updatedAt state { name } labels { nodes { name } } inverseRelations { nodes { type issue { id identifier state { name } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const issueStatesByIdsQuery = `
query SymphonyIssueStatesByIds($ids: [ID!]) {
  issues(filter: { id: { in: $ids } }) {
    nodes { id identifier title description priority branchName url createdAt updatedAt state { name } labels { nodes { name } } inverseRelations { nodes { type issue { id identifier state { name } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const issueDiscussionQuery = `
query SymphonyIssueDiscussion($id: String!) {
  issue(id: $id) {
    id
    description
    comments(first: 50) {
      nodes { id body createdAt user { id name email displayName } }
    }
  }
}`;

export const updateIssueDescriptionMutation = `
mutation SymphonyUpdateIssueDescription($id: String!, $description: String!) {
  issueUpdate(id: $id, input: { description: $description }) {
    success
  }
}`;

export const createCommentMutation = `
mutation SymphonyCreateComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
  }
}`;
