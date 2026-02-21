// ============================================================================
// Shared GitHub helpers (no Next.js / @/ alias dependencies)
// ============================================================================

import { Octokit } from "@octokit/rest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoIdentifier {
  owner: string;
  repo: string;
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createOctokit(token?: string): Octokit {
  return token ? new Octokit({ auth: token }) : new Octokit();
}

// ---------------------------------------------------------------------------
// Repo slug parser
// ---------------------------------------------------------------------------

/** Parse "owner/repo" or a full GitHub URL into { owner, repo }. */
export function parseRepoSlug(input: string): RepoIdentifier {
  const cleaned = input.trim().replace(/\.git$/, "");

  const urlMatch = cleaned.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  const slugMatch = cleaned.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (slugMatch) {
    return { owner: slugMatch[1], repo: slugMatch[2] };
  }

  throw new Error(`Invalid repository: "${input}". Use "owner/repo" or a GitHub URL.`);
}

// ---------------------------------------------------------------------------
// REST API helpers (take an Octokit instance)
// ---------------------------------------------------------------------------

export async function fetchDeployments(octokit: Octokit, id: RepoIdentifier, count = 50) {
  const { data } = await octokit.repos.listDeployments({
    owner: id.owner,
    repo: id.repo,
    per_page: count,
  });
  return data;
}

export async function fetchMergedPRs(octokit: Octokit, id: RepoIdentifier, count = 30) {
  const { data } = await octokit.pulls.list({
    owner: id.owner,
    repo: id.repo,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: count,
  });
  return data.filter((pr) => pr.merged_at !== null);
}

export async function fetchWorkflowRuns(octokit: Octokit, id: RepoIdentifier, count = 50) {
  const { data } = await octokit.actions.listWorkflowRunsForRepo({
    owner: id.owner,
    repo: id.repo,
    per_page: count,
  });
  return data.workflow_runs;
}

export async function fetchFileContent(
  octokit: Octokit,
  id: RepoIdentifier,
  path: string,
): Promise<string | null> {
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
