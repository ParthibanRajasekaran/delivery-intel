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
      isInferred: false,
      coverage: { sampleSize: 0, windowDays: 0 },
      assumptions: [],
      howToImproveAccuracy: [
        "Add GitHub Actions CI workflows to enable pipeline failure rate tracking.",
      ],
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
      isInferred: false,
      coverage: { sampleSize: 0, windowDays: 30 },
      assumptions: [],
      howToImproveAccuracy: [],
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
    isInferred: false,
    coverage: { sampleSize: completed.length, windowDays: 30 },
    assumptions: [
      "Workflow runs with conclusion='failure' are counted as failures. Cancelled and skipped runs are excluded.",
    ],
    howToImproveAccuracy:
      completed.length < 20 ? ["More workflow runs are needed (≥20) for high confidence."] : [],
  };
}
