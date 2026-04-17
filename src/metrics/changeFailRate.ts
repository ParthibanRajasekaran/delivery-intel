// ============================================================================
// Metric Engine: Change Fail Rate (DORA)
// ============================================================================
// DORA definition: % of deployments that caused a production failure requiring
// remediation (rollback, hotfix, incident). Computed from deployment statuses.
// Falls back to null (not inferred from pipeline runs) because pipeline fails
// ≠ production incidents.
// ============================================================================

import type { EvidenceEvent } from "../domain/evidence.js";
import { isProductionEnvironment, isRollbackSignal, isHotfixSignal } from "../domain/evidence.js";
import type { MetricResult, ChangeFailRateValue } from "../domain/metrics.js";
import { tierChangeFailRate } from "../domain/metrics.js";
import type { RepoEvidenceProfile } from "../domain/repoProfile.js";
import { eventsByType } from "../normalize/githubEvidence.js";

export function computeChangeFailRate(
  events: EvidenceEvent[],
  profile: RepoEvidenceProfile,
): MetricResult<ChangeFailRateValue> {
  if (!profile.hasDeploymentStatuses || !profile.hasProductionDeployments) {
    // Attempt heuristic from PR labels / titles (low confidence)
    const merges = eventsByType(events, "PullRequestMerged");
    if (merges.length >= 5) {
      const reworkMerges = merges.filter(
        (m) => isRollbackSignal(m.title, m.labels) || isHotfixSignal(m.title, m.labels),
      );
      const pct = +((reworkMerges.length / merges.length) * 100).toFixed(1);
      return {
        key: "changeFailRate",
        value: {
          percentage: pct,
          reworkCount: reworkMerges.length,
          totalDeployments: merges.length,
        },
        tier: tierChangeFailRate(pct),
        confidence: "low",
        evidenceSources: ["GitHub Pull Requests (rollback/hotfix title/label heuristic)"],
        caveats: [
          "No production deployment status data available.",
          "Change Fail Rate estimated from PR titles/labels matching rollback, hotfix, revert, or incident patterns.",
          "This is an approximation — actual DORA CFR requires production deployment failure data.",
        ],
        isInferred: true,
        coverage: { sampleSize: merges.length, windowDays: 30 },
        assumptions: [
          "PRs with titles/labels containing 'revert', 'rollback', 'hotfix', or 'incident' are counted as failures.",
          "Teams that don't label hotfixes will appear to have a lower than actual CFR.",
        ],
        howToImproveAccuracy: [
          "Emit GitHub deployment events with explicit success/failure status updates.",
          "Label hotfix and rollback PRs consistently so heuristic detection is more reliable.",
        ],
      };
    }

    return {
      key: "changeFailRate",
      value: null,
      tier: "Unknown",
      confidence: "unknown",
      evidenceSources: [],
      caveats: [
        "Cannot compute Change Fail Rate without production deployment status data.",
        "Connect GitHub Deployments with explicit success/failure statuses to enable this metric.",
      ],
      isInferred: true,
      coverage: { sampleSize: 0, windowDays: 0 },
      assumptions: [],
      howToImproveAccuracy: [
        "Emit GitHub deployment events with success/failure status from your CI/CD pipeline.",
      ],
    };
  }

  // Primary: production deployment failure statuses
  const prodStatuses = eventsByType(events, "DeploymentStatusObserved").filter(
    (s) =>
      (s.state === "success" || s.state === "failure" || s.state === "error") &&
      s.environment !== null &&
      isProductionEnvironment(s.environment ?? ""),
  );

  // One terminal status per deployment (last one wins)
  const terminalByDeployment = new Map<number, (typeof prodStatuses)[number]>();
  for (const s of prodStatuses) {
    const existing = terminalByDeployment.get(s.deploymentId);
    if (!existing || new Date(s.at) > new Date(existing.at)) {
      terminalByDeployment.set(s.deploymentId, s);
    }
  }

  const total = terminalByDeployment.size;
  if (total === 0) {
    return {
      key: "changeFailRate",
      value: { percentage: 0, reworkCount: 0, totalDeployments: 0 },
      tier: "Unknown",
      confidence: "low",
      evidenceSources: ["GitHub Deployment Statuses (production)"],
      caveats: ["No terminal production deployment statuses found."],
      isInferred: false,
      coverage: { sampleSize: 0, windowDays: 30 },
      assumptions: [],
      howToImproveAccuracy: [
        "Ensure your deploy workflow emits both 'success' and 'failure' deployment status updates.",
      ],
    };
  }

  const failed = [...terminalByDeployment.values()].filter(
    (s) => s.state === "failure" || s.state === "error",
  ).length;

  const pct = +((failed / total) * 100).toFixed(1);
  return {
    key: "changeFailRate",
    value: { percentage: pct, reworkCount: failed, totalDeployments: total },
    tier: tierChangeFailRate(pct),
    confidence: total >= 10 ? "high" : total >= 3 ? "medium" : "low",
    evidenceSources: ["GitHub Deployment Statuses (production, terminal state)"],
    caveats: [],
    isInferred: false,
    coverage: { sampleSize: total, windowDays: 30 },
    assumptions: [
      "Each deployment's terminal state (success/failure/error) is used. Rollback events are not separately tracked.",
    ],
    howToImproveAccuracy:
      total < 10
        ? ["Increase sample size — need ≥10 production deployments for high confidence."]
        : [],
  };
}
