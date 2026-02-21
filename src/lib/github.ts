// ============================================================================
// GitHub REST + GraphQL Service Layer
// ============================================================================

import type { Octokit } from "@octokit/rest";
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
import {
  parseRepoSlug as _parseRepoSlug,
  createOctokit as _createOctokit,
  fetchDeployments as _fetchDeployments,
  fetchMergedPRs as _fetchMergedPRs,
  fetchWorkflowRuns as _fetchWorkflowRuns,
  fetchFileContent as _fetchFileContent,
} from "../shared/github";

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

function getToken(): string | undefined {
  return process.env.GITHUB_TOKEN || undefined;
}

function createOctokit(): Octokit {
  return _createOctokit(getToken());
}

function createGraphQL() {
  const token = getToken();
  if (!token) {
    return (() => {
      throw new Error("GraphQL API requires authentication. Set GITHUB_TOKEN for this feature.");
    }) as unknown as ReturnType<typeof graphql.defaults>;
  }
  return graphql.defaults({
    headers: { authorization: `token ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Re-export parseRepoSlug from shared module
// ---------------------------------------------------------------------------

export const parseRepoSlug = _parseRepoSlug;

// ---------------------------------------------------------------------------
// REST API calls (thin wrappers over shared helpers)
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
  const runs = await _fetchWorkflowRuns(createOctokit(), id, count);
  return runs as unknown as GitHubWorkflowRun[];
}

/** Fetch formal GitHub Deployments. */
export async function fetchDeployments(
  id: RepoIdentifier,
  count = 30,
): Promise<GitHubDeployment[]> {
  const deployments = await _fetchDeployments(createOctokit(), id, count);
  return deployments as unknown as GitHubDeployment[];
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
  const prs = await _fetchMergedPRs(createOctokit(), id, count);
  return prs as unknown as GitHubPullRequest[];
}

/** Fetch the raw content of a file (e.g., package.json). Returns null if not found. */
export async function fetchFileContent(id: RepoIdentifier, path: string): Promise<string | null> {
  return _fetchFileContent(createOctokit(), id, path);
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
