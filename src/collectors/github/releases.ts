// ============================================================================
// Collector: GitHub Releases
// ============================================================================

import type { Octokit } from "@octokit/rest";
import type { RepoIdentifier } from "../../shared/github.js";
import type { RawRelease } from "../../domain/evidence.js";

export async function collectReleases(
  octokit: Octokit,
  id: RepoIdentifier,
  perPage = 100,
): Promise<RawRelease[]> {
  try {
    const { data } = await octokit.repos.listReleases({
      owner: id.owner,
      repo: id.repo,
      per_page: perPage,
    });
    return data.map((r) => ({
      id: r.id,
      tag_name: r.tag_name,
      name: r.name ?? null,
      created_at: r.created_at,
      published_at: r.published_at ?? null,
      prerelease: r.prerelease,
      draft: r.draft,
    }));
  } catch {
    return [];
  }
}
