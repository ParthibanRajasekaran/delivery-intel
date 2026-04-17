// ============================================================================
// Metric Engine: Pipeline Failure Rate
// ============================================================================
// Distinct from Change Fail Rate — this measures CI/CD pipeline reliability,
// not production deployment failure rate. Workflow runs ≠ production deploys.
// ============================================================================

import type { EvidenceEvent } from "../domain/evidence.js";
import type { MetricResult, PipelineFailureRateValue } from "../domain/metrics.js";
import { tierPipelineFailRate } from "../domain/metrics.js";
import type { RepoEvidenceProfile } from "../domain/repoProfile.js";
import { eventsByType } from "../normalize/githubEvidence.js";

export function computePipelineFailureRate(
  events: EvidenceEvent[],
  profile: RepoEvidenceProfile,
): MetricResult<PipelineFailureRateValue> {
  if (!profile.hasActionsRuns) {
    return {
      key: "pipelineFailureRate",
      value: null,
      tier: "Unknown",
      confidence: "unknown",
      evidenceSources: [],
      caveats: ["No GitHub Actions workflow runs found."],
    };
  }

  const runs = eventsByType(events, "WorkflowRunObserved");
  const completed = runs.filter((r) => r.status === "completed");

  if (completed.length === 0) {
    return {
      key: "pipelineFailureRate",
      value: { percentage: 0, failedRuns: 0, totalRuns: 0 },
      tier: "Unknown",
      confidence: "unknown",
      evidenceSources: ["GitHub Actions Workflow Runs"],
      caveats: ["No completed workflow runs found."],
    };
  }

  const failed = completed.filter((r) => r.conclusion === "failure");
  const pct = +((failed.length / completed.length) * 100).toFixed(1);

  return {
    key: "pipelineFailureRate",
    value: { percentage: pct, failedRuns: failed.length, totalRuns: completed.length },
    tier: tierPipelineFailRate(pct),
    confidence: completed.length >= 20 ? "high" : completed.length >= 5 ? "medium" : "low",
    evidenceSources: ["GitHub Actions Workflow Runs"],
    caveats: [
      "Pipeline failure rate measures CI workflow run outcomes, not production deployment failures.",
      "DORA's Change Fail Rate requires production deployment data and is computed separately.",
    ],
  };
}
