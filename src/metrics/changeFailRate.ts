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
  };
}
