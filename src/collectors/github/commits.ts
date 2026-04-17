// ============================================================================
// Collector: GitHub Commits
// ============================================================================

import type { Octokit } from "@octokit/rest";
import type { RepoIdentifier } from "../../shared/github.js";
import type { RawCommit } from "../../domain/evidence.js";

export async function collectCommits(
  octokit: Octokit,
  id: RepoIdentifier,
  perPage = 100,
): Promise<RawCommit[]> {
  try {
    const { data } = await octokit.repos.listCommits({
      owner: id.owner,
      repo: id.repo,
      per_page: perPage,
    });
    return data.map((c) => ({
      sha: c.sha,
      committed_at: c.commit.committer?.date ?? c.commit.author?.date ?? "",
      message: c.commit.message ?? "",
    }));
  } catch {
    return [];
  }
}
