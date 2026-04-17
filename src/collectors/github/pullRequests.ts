// ============================================================================
// Collector: GitHub Pull Requests
// ============================================================================

import type { Octokit } from "@octokit/rest";
import type { RepoIdentifier } from "../../shared/github.js";
import type { RawPullRequest } from "../../domain/evidence.js";

export async function collectPullRequests(
  octokit: Octokit,
  id: RepoIdentifier,
  perPage = 100,
): Promise<RawPullRequest[]> {
  try {
    const { data } = await octokit.pulls.list({
      owner: id.owner,
      repo: id.repo,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: perPage,
    });
    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      created_at: pr.created_at,
      merged_at: pr.merged_at ?? null,
      closed_at: pr.closed_at ?? null,
      head_sha: pr.head?.sha ?? null,
      labels: pr.labels?.map((l) => l.name ?? "").filter(Boolean) ?? [],
    }));
  } catch {
    return [];
  }
}
