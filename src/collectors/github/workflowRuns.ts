// ============================================================================
// Collector: GitHub Workflow Runs
// ============================================================================

import type { Octokit } from "@octokit/rest";
import type { RepoIdentifier } from "../../shared/github.js";
import type { RawWorkflowRun } from "../../domain/evidence.js";

export async function collectWorkflowRuns(
  octokit: Octokit,
  id: RepoIdentifier,
  perPage = 100,
): Promise<RawWorkflowRun[]> {
  try {
    const { data } = await octokit.actions.listWorkflowRunsForRepo({
      owner: id.owner,
      repo: id.repo,
      per_page: perPage,
    });
    return data.workflow_runs.map((r) => ({
      id: r.id,
      name: r.name ?? null,
      workflow_id: r.workflow_id,
      event: r.event,
      status: r.status ?? null,
      conclusion: r.conclusion ?? null,
      head_sha: r.head_sha,
      created_at: r.created_at,
      updated_at: r.updated_at,
      run_attempt: r.run_attempt ?? 1,
    }));
  } catch {
    return [];
  }
}
