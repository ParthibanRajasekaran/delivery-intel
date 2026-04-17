// ============================================================================
// Collector: GitHub Issues (incident / bug signal)
// ============================================================================

import type { Octokit } from "@octokit/rest";
import type { RepoIdentifier } from "../../shared/github.js";
import type { RawIssue } from "../../domain/evidence.js";

export async function collectIssues(
  octokit: Octokit,
  id: RepoIdentifier,
  perPage = 100,
): Promise<RawIssue[]> {
  try {
    const { data } = await octokit.issues.listForRepo({
      owner: id.owner,
      repo: id.repo,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: perPage,
    });
    return data
      .filter((i) => !i.pull_request) // exclude PRs from the issues endpoint
      .map((i) => ({
        number: i.number,
        title: i.title,
        labels: i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
        state: i.state as "open" | "closed",
        created_at: i.created_at,
        closed_at: i.closed_at ?? null,
      }));
  } catch {
    return [];
  }
}
