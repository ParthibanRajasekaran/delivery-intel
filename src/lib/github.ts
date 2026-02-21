// ============================================================================
// GitHub REST + GraphQL Service Layer
// ============================================================================

import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import type {
  RepoIdentifier,
  GitHubCommit,
  GitHubWorkflowRun,
  GitHubDeployment,
  GitHubDeploymentStatus,
  GitHubPullRequest,
  GQLPullRequestsResponse,
} from "@/types";

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------
// Token is optional — unauthenticated requests work for public repos
// but are limited to 60 req/hr (vs 5,000 with a token).
// ---------------------------------------------------------------------------

function getToken(): string | undefined {
  return process.env.GITHUB_TOKEN || undefined;
}

function createOctokit(): Octokit {
  const token = getToken();
  return token ? new Octokit({ auth: token }) : new Octokit();
}

function createGraphQL() {
  const token = getToken();
  if (!token) {
    // GraphQL requires auth — return a function that throws a clear error
    return (() => {
      throw new Error("GraphQL API requires authentication. Set GITHUB_TOKEN for this feature.");
    }) as unknown as ReturnType<typeof graphql.defaults>;
  }
  return graphql.defaults({
    headers: { authorization: `token ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "owner/repo" or a full GitHub URL into { owner, repo }. */
export function parseRepoSlug(input: string): RepoIdentifier {
  // Strip trailing .git and whitespace
  const cleaned = input.trim().replace(/\.git$/, "");

  // Full URL: https://github.com/owner/repo
  const urlMatch = cleaned.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  // Slug: owner/repo
  const slugMatch = cleaned.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (slugMatch) {
    return { owner: slugMatch[1], repo: slugMatch[2] };
  }

  throw new Error(`Invalid repository identifier: "${input}". Use "owner/repo" or a GitHub URL.`);
}

// ---------------------------------------------------------------------------
// REST API calls
// ---------------------------------------------------------------------------

/** Fetch the last N commits from the default branch. */
export async function fetchRecentCommits(id: RepoIdentifier, count = 5): Promise<GitHubCommit[]> {
  const octokit = createOctokit();
  const { data } = await octokit.repos.listCommits({
    owner: id.owner,
    repo: id.repo,
    per_page: count,
  });
  return data as unknown as GitHubCommit[];
}

/** Fetch workflow runs (CI/CD pipelines). */
export async function fetchWorkflowRuns(
  id: RepoIdentifier,
  count = 30,
): Promise<GitHubWorkflowRun[]> {
  const octokit = createOctokit();
  const { data } = await octokit.actions.listWorkflowRunsForRepo({
    owner: id.owner,
    repo: id.repo,
    per_page: count,
  });
  return data.workflow_runs as unknown as GitHubWorkflowRun[];
}

/** Fetch formal GitHub Deployments. */
export async function fetchDeployments(
  id: RepoIdentifier,
  count = 30,
): Promise<GitHubDeployment[]> {
  const octokit = createOctokit();
  const { data } = await octokit.repos.listDeployments({
    owner: id.owner,
    repo: id.repo,
    per_page: count,
  });
  return data as unknown as GitHubDeployment[];
}

/** Fetch statuses for a single deployment. */
export async function fetchDeploymentStatuses(
  id: RepoIdentifier,
  deploymentId: number,
): Promise<GitHubDeploymentStatus[]> {
  const octokit = createOctokit();
  const { data } = await octokit.repos.listDeploymentStatuses({
    owner: id.owner,
    repo: id.repo,
    deployment_id: deploymentId,
  });
  return data as unknown as GitHubDeploymentStatus[];
}

/** Fetch recent merged pull requests to the default branch. */
export async function fetchMergedPullRequests(
  id: RepoIdentifier,
  count = 30,
): Promise<GitHubPullRequest[]> {
  const octokit = createOctokit();
  const { data } = await octokit.pulls.list({
    owner: id.owner,
    repo: id.repo,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: count,
  });
  // Filter to only merged PRs
  return (data as unknown as GitHubPullRequest[]).filter((pr) => pr.merged_at !== null);
}

/** Fetch the raw content of a file (e.g., package.json). Returns null if not found. */
export async function fetchFileContent(id: RepoIdentifier, path: string): Promise<string | null> {
  const octokit = createOctokit();
  try {
    const { data } = await octokit.repos.getContent({
      owner: id.owner,
      repo: id.repo,
      path,
    });
    if ("content" in data && typeof data.content === "string") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return null;
  } catch {
    return null;
  }
}

/** Get the default branch name for a repo. */
export async function fetchDefaultBranch(id: RepoIdentifier): Promise<string> {
  const octokit = createOctokit();
  const { data } = await octokit.repos.get({
    owner: id.owner,
    repo: id.repo,
  });
  return data.default_branch;
}

// ---------------------------------------------------------------------------
// GraphQL — Pull Requests + Deployment statuses (the "hard" query)
// ---------------------------------------------------------------------------

const PR_DEPLOYMENTS_QUERY = `
  query ($owner: String!, $repo: String!, $count: Int!) {
    repository(owner: $owner, name: $repo) {
      defaultBranchRef {
        name
      }
      pullRequests(
        last: $count
        states: MERGED
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        nodes {
          number
          title
          createdAt
          mergedAt
          state
          headRefOid
          baseRefName
          author {
            login
            avatarUrl
          }
          url
          commits(last: 1) {
            nodes {
              commit {
                committedDate
                deployments(last: 1) {
                  nodes {
                    environment
                    createdAt
                    state
                    latestStatus {
                      state
                      createdAt
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Single GraphQL call that fetches merged PRs AND their linked deployment
 * statuses. This is the most API-credit-efficient way to compute Lead Time.
 */
export async function fetchPRsWithDeployments(
  id: RepoIdentifier,
  count = 10,
): Promise<GQLPullRequestsResponse> {
  const gql = createGraphQL();
  const response = await gql<GQLPullRequestsResponse>(PR_DEPLOYMENTS_QUERY, {
    owner: id.owner,
    repo: id.repo,
    count,
  });
  return response;
}
