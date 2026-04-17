// ============================================================================
// Metric Engine: Deployment Rework Rate
// ============================================================================
// New DORA 5th metric: percentage of deployments that are rework
// (rollback, revert, hotfix) rather than net-new change delivery.
// ============================================================================

import type { EvidenceEvent } from "../domain/evidence.js";
import { isProductionEnvironment, isRollbackSignal, isHotfixSignal } from "../domain/evidence.js";
import type { MetricResult, DeploymentReworkRateValue } from "../domain/metrics.js";
import { tierReworkRate } from "../domain/metrics.js";
import type { RepoEvidenceProfile } from "../domain/repoProfile.js";
import { eventsByType } from "../normalize/githubEvidence.js";

export function computeDeploymentReworkRate(
  events: EvidenceEvent[],
  profile: RepoEvidenceProfile,
): MetricResult<DeploymentReworkRateValue> {
  const caveats: string[] = [
    "Rework detection uses heuristics: rollback/revert/hotfix in PR title or labels, " +
      "and rapid corrective deployments after a failure.",
    "This metric is marked as inferred — it is not authoritative without explicit rework tracking.",
  ];

  // Best case: production deployments with PR linkage via ref/sha
  if (profile.hasProductionDeployments) {
    const deploys = eventsByType(events, "DeploymentObserved").filter((d) =>
      isProductionEnvironment(d.environment),
    );

    if (deploys.length >= 5) {
      const merges = eventsByType(events, "PullRequestMerged");
      const reworkDeploys = deploys.filter((d) => {
        // Find a merged PR whose head sha matches this deployment sha
        const linkedPR = merges.find(
          (m) => m.prNumber.toString() === d.ref.replace(/^refs\/pull\/(\d+)\/.*/, "$1"),
        );
        if (linkedPR) {
          return (
            isRollbackSignal(linkedPR.title, linkedPR.labels) ||
            isHotfixSignal(linkedPR.title, linkedPR.labels)
          );
        }
        // Fallback: check if the ref itself looks like a hotfix/rollback branch
        return isRollbackSignal(d.ref, []) || isHotfixSignal(d.ref, []);
      });

      const pct = +((reworkDeploys.length / deploys.length) * 100).toFixed(1);
      return {
        key: "deploymentReworkRate",
        value: {
          percentage: pct,
          reworkCount: reworkDeploys.length,
          totalDeployments: deploys.length,
        },
        tier: tierReworkRate(pct),
        confidence: "low",
        evidenceSources: [
          "GitHub Deployments API (production)",
          "GitHub Pull Requests (title/label heuristics)",
        ],
        caveats,
        isInferred: true,
        coverage: { sampleSize: deploys.length, windowDays: 30 },
        assumptions: [
          "Deployments linked to PRs with rollback/hotfix labels or branch names containing those signals are counted as rework.",
          "Deployments without a linked PR are checked by ref name only.",
        ],
        howToImproveAccuracy: [
          "Label all rollback and hotfix PRs explicitly with 'rollback', 'hotfix', or 'revert' labels.",
          "Track rework deployments with a dedicated GitHub Deployment environment (e.g. 'rollback-production').",
        ],
      };
    }
  }

  // Fallback: PR-only heuristic
  const merges = eventsByType(events, "PullRequestMerged");
  if (merges.length >= 5) {
    const rework = merges.filter(
      (m) => isRollbackSignal(m.title, m.labels) || isHotfixSignal(m.title, m.labels),
    );
    const pct = +((rework.length / merges.length) * 100).toFixed(1);
    return {
      key: "deploymentReworkRate",
      value: { percentage: pct, reworkCount: rework.length, totalDeployments: merges.length },
      tier: tierReworkRate(pct),
      confidence: "low",
      evidenceSources: ["GitHub Pull Requests (rollback/hotfix title/label heuristic)"],
      caveats: [
        ...caveats,
        "No production deployment data found. Using merged PRs as deployment proxy.",
      ],
      isInferred: true,
      coverage: { sampleSize: merges.length, windowDays: 30 },
      assumptions: [
        "Merged PRs with rollback/hotfix/revert in title or labels are treated as rework deployments.",
        "Teams that don't label rework PRs will appear to have a lower than actual rework rate.",
      ],
      howToImproveAccuracy: [
        "Emit GitHub deployment events to measure actual production deployment rework rate.",
        "Label all rollback, hotfix, and revert PRs consistently.",
      ],
    };
  }

  return {
    key: "deploymentReworkRate",
    value: null,
    tier: "Unknown",
    confidence: "unknown",
    evidenceSources: [],
    caveats: ["Insufficient data to compute deployment rework rate."],
    isInferred: true,
    coverage: { sampleSize: 0, windowDays: 0 },
    assumptions: [],
    howToImproveAccuracy: [
      "Ensure PRs are created and merged via GitHub, or add GitHub Deployment events.",
    ],
  };
}
