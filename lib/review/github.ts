// The GitHub review API, as verified against it rather than as documented.
//
// Probed on 2026-08-21 against a real pull request:
//
//   - a review created with `comments[]` places them exactly where asked
//     (path, line and side came back unchanged)
//   - `in_reply_to` inside a review's `comments[]` is **rejected** (422), so a
//     reply cannot be batched into a review and must go to the replies endpoint
//   - out-of-hunk lines and unknown paths are rejected (422)
//   - mixed-side ranges and pre-rename paths are accepted
//   - resolving needs GraphQL; there is no REST equivalent
//
// That is what shapes the store: new threads batch into one review, replies post
// immediately, and resolve goes through GraphQL.

const API = 'https://api.github.com';
const GRAPHQL = `${API}/graphql`;
const API_VERSION = '2022-11-28';

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  pull: number;
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors?: unknown
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

function headers(token: string, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
    'Content-Type': 'application/json',
    'User-Agent': 'hunkyard',
  };
}

async function readError(response: Response): Promise<GitHubApiError> {
  let message = `${response.status} ${response.statusText}`;
  let errors: unknown;
  try {
    const body = (await response.json()) as { message?: string; errors?: unknown };
    if (typeof body.message === 'string') message = body.message;
    errors = body.errors;
    // GitHub's 422 for a comment says only "Unprocessable Entity" unless the
    // errors array is surfaced, and that array is what says which line was
    // wrong.
    if (Array.isArray(errors) && errors.length > 0) {
      message = `${message}: ${JSON.stringify(errors)}`;
    }
  } catch {
    // keep the status line
  }
  return new GitHubApiError(response.status, message, errors);
}

export async function githubRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers ?? {}) },
  });
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function githubGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string
): Promise<T> {
  const response = await fetch(GRAPHQL, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw await readError(response);
  const body = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (body.errors != null && body.errors.length > 0) {
    // GraphQL answers 200 with an errors array, so a failure here would
    // otherwise look like success with missing data.
    throw new GitHubApiError(200, body.errors.map((e) => e.message).join('; '));
  }
  if (body.data == null) throw new GitHubApiError(200, 'GraphQL returned no data');
  return body.data;
}

// --- shapes we read back ---

export interface GitHubReviewComment {
  id: number;
  node_id: string;
  path: string;
  body: string;
  line: number | null;
  original_line: number | null;
  start_line: number | null;
  side: 'LEFT' | 'RIGHT' | null;
  start_side: 'LEFT' | 'RIGHT' | null;
  commit_id: string;
  created_at: string;
  updated_at: string;
  in_reply_to_id?: number;
  user: { login: string; avatar_url: string } | null;
}

export interface NewReviewComment {
  path: string;
  body: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
}

export function listReviewComments(
  ref: GitHubRepoRef,
  token: string
): Promise<GitHubReviewComment[]> {
  return githubRequest<GitHubReviewComment[]>(
    `/repos/${ref.owner}/${ref.repo}/pulls/${ref.pull}/comments?per_page=100`,
    token
  );
}

export function getPullHeadSha(
  ref: GitHubRepoRef,
  token: string
): Promise<string> {
  return githubRequest<{ head: { sha: string } }>(
    `/repos/${ref.owner}/${ref.repo}/pulls/${ref.pull}`,
    token
  ).then((pull) => pull.head.sha);
}

// One review carrying every queued comment. This is the only call that places
// new comments; adding them one at a time would send a notification per comment.
export function submitReview(
  ref: GitHubRepoRef,
  token: string,
  input: {
    commitId: string;
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
    body?: string;
    comments: NewReviewComment[];
  }
): Promise<{ id: number }> {
  return githubRequest<{ id: number }>(
    `/repos/${ref.owner}/${ref.repo}/pulls/${ref.pull}/reviews`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        commit_id: input.commitId,
        event: input.event,
        ...(input.body == null || input.body === '' ? {} : { body: input.body }),
        comments: input.comments,
      }),
    }
  );
}

// Replies cannot ride along in a review; verified 422. So they post on their own
// and are visible immediately, which also matches what GitHub's own UI does when
// you reply outside a review.
export function replyToComment(
  ref: GitHubRepoRef,
  token: string,
  commentId: number,
  body: string
): Promise<GitHubReviewComment> {
  return githubRequest<GitHubReviewComment>(
    `/repos/${ref.owner}/${ref.repo}/pulls/${ref.pull}/comments/${commentId}/replies`,
    token,
    { method: 'POST', body: JSON.stringify({ body }) }
  );
}

// Note the path: no pull number. Using the pull-scoped path silently fails.
export function deleteComment(
  ref: GitHubRepoRef,
  token: string,
  commentId: number
): Promise<void> {
  return githubRequest<void>(
    `/repos/${ref.owner}/${ref.repo}/pulls/comments/${commentId}`,
    token,
    { method: 'DELETE' }
  );
}

interface ReviewThreadNode {
  id: string;
  isResolved: boolean;
  comments: { nodes: { databaseId: number | null }[] };
}

// GraphQL thread ids are unrelated to REST comment ids, so resolving needs a
// lookup from one to the other.
export async function listThreadNodes(
  ref: GitHubRepoRef,
  token: string
): Promise<ReviewThreadNode[]> {
  const data = await githubGraphQL<{
    repository: { pullRequest: { reviewThreads: { nodes: ReviewThreadNode[] } } };
  }>(
    `query($owner:String!,$repo:String!,$pull:Int!){
       repository(owner:$owner,name:$repo){
         pullRequest(number:$pull){
           reviewThreads(first:100){
             nodes{ id isResolved comments(first:100){ nodes{ databaseId } } }
           }
         }
       }
     }`,
    { owner: ref.owner, repo: ref.repo, pull: ref.pull },
    token
  );
  return data.repository.pullRequest.reviewThreads.nodes;
}

export async function setThreadResolved(
  threadNodeId: string,
  resolved: boolean,
  token: string
): Promise<boolean> {
  const mutation = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
  const data = await githubGraphQL<Record<string, { thread: { isResolved: boolean } }>>(
    `mutation($id:ID!){ ${mutation}(input:{threadId:$id}){ thread{ isResolved } } }`,
    { id: threadNodeId },
    token
  );
  return data[mutation].thread.isResolved;
}
