// ============================================================================
// Collector: GitHub Contributors + Branch Protection
// ============================================================================

import type { Octokit } from "@octokit/rest";
import type { RepoIdentifier } from "../../shared/github.js";
import type { RawContributor, RawBranchProtection } from "../../domain/evidence.js";

export async function collectContributors(
  octokit: Octokit,
  id: RepoIdentifier,
): Promise<RawContributor[]> {
  try {
    const { data } = await octokit.repos.listContributors({
      owner: id.owner,
      repo: id.repo,
      per_page: 100,
    });
    return data.map((c) => ({
      login: c.login ?? "unknown",
      contributions: c.contributions,
    }));
  } catch {
    return [];
  }
}

export async function collectBranchProtection(
  octokit: Octokit,
  id: RepoIdentifier,
  branch = "main",
): Promise<RawBranchProtection | null> {
  try {
    const { data } = await octokit.repos.getBranchProtection({
      owner: id.owner,
      repo: id.repo,
      branch,
    });
    return {
      protected: true,
      requiredReviewers: data.required_pull_request_reviews?.required_approving_review_count ?? 0,
      requireStatusChecks:
        data.required_status_checks !== null && data.required_status_checks !== undefined,
      enforceAdmins: data.enforce_admins?.enabled ?? false,
      requireUpToDate: data.required_status_checks?.strict ?? false,
    };
  } catch {
    // 404 = no protection configured, or insufficient permissions
    return null;
  }
}
