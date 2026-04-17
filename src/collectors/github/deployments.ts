// ============================================================================
// Collector: GitHub Deployments + Deployment Statuses
// ============================================================================

import type { Octokit } from "@octokit/rest";
import type { RepoIdentifier } from "../../shared/github.js";
import type { RawDeployment, RawDeploymentStatus } from "../../domain/evidence.js";

export async function collectDeployments(
  octokit: Octokit,
  id: RepoIdentifier,
  perPage = 100,
): Promise<RawDeployment[]> {
  try {
    const { data } = await octokit.repos.listDeployments({
      owner: id.owner,
      repo: id.repo,
      per_page: perPage,
    });
    return data.map((d) => ({
      id: d.id,
      sha: d.sha,
      ref: d.ref,
      environment: d.environment,
      created_at: d.created_at,
      updated_at: d.updated_at,
      description: d.description ?? null,
    }));
  } catch {
    return [];
  }
}

export async function collectDeploymentStatuses(
  octokit: Octokit,
  id: RepoIdentifier,
  deploymentIds: number[],
): Promise<Map<number, RawDeploymentStatus[]>> {
  const result = new Map<number, RawDeploymentStatus[]>();
  // Fetch statuses for all deployments in parallel (max 20 concurrent)
  const chunks: number[][] = [];
  for (let i = 0; i < deploymentIds.length; i += 20) {
    chunks.push(deploymentIds.slice(i, i + 20));
  }
  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (deploymentId) => {
        try {
          const { data } = await octokit.repos.listDeploymentStatuses({
            owner: id.owner,
            repo: id.repo,
            deployment_id: deploymentId,
            per_page: 10,
          });
          result.set(
            deploymentId,
            data.map((s) => ({
              id: s.id,
              deploymentId,
              state: s.state,
              environment: s.environment ?? null,
              created_at: s.created_at,
            })),
          );
        } catch {
          result.set(deploymentId, []);
        }
      }),
    );
  }
  return result;
}
