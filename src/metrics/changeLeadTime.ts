// ============================================================================
// Metric Engine: Change Lead Time
// ============================================================================
// DORA definition: time from code committed to successfully deployed in prod.
// When prod deployment data is absent, falls back to PR flow time (open→merge).
// Both signals are computed and exposed separately so callers can be
// transparent about which one is being used.
// ============================================================================

import type { EvidenceEvent } from "../domain/evidence.js";
import { isProductionEnvironment } from "../domain/evidence.js";
import type { MetricResult, ChangeLeadTimeValue } from "../domain/metrics.js";
import { tierLeadTime } from "../domain/metrics.js";
import type { RepoEvidenceProfile } from "../domain/repoProfile.js";
import { eventsByType } from "../normalize/githubEvidence.js";
import { median, differenceInHours } from "./shared.js";

export function computeChangeLeadTime(
  events: EvidenceEvent[],
  profile: RepoEvidenceProfile,
): MetricResult<ChangeLeadTimeValue> {
  // --- Compute PR flow time (always available as fallback) ---
  const merges = eventsByType(events, "PullRequestMerged");
  const prFlowHours = merges
    .filter((m) => m.openedAt)
    .map((m) => differenceInHours(new Date(m.at), new Date(m.openedAt)));

  const prFlowMedian = prFlowHours.length > 0 ? +median(prFlowHours).toFixed(1) : null;

  // --- Try commit-to-deploy (DORA definition) ---
  if (profile.hasDeploymentStatuses && profile.hasProductionDeployments) {
    const successStatuses = eventsByType(events, "DeploymentStatusObserved").filter(
      (s) =>
        s.state === "success" &&
        s.environment !== null &&
        isProductionEnvironment(s.environment ?? ""),
    );

    const deploys = eventsByType(events, "DeploymentObserved");
    const commits = eventsByType(events, "CommitObserved");

    // For each successful prod deployment, find the commit it deployed and measure
    const commitToDeployHours: number[] = [];
    for (const status of successStatuses) {
      const deploy = deploys.find((d) => d.deploymentId === status.deploymentId);
      if (!deploy?.sha) {
        continue;
      }
      const commit = commits.find((c) => c.sha === deploy.sha);
      if (!commit) {
        continue;
      }
      const hours = differenceInHours(new Date(status.at), new Date(commit.at));
      if (hours >= 0) {
        commitToDeployHours.push(hours);
      }
    }

    if (commitToDeployHours.length >= 3) {
      const med = +median(commitToDeployHours).toFixed(1);
      return {
        key: "changeLeadTime",
        value: {
          commitToDeployMedianHours: med,
          prFlowMedianHours: prFlowMedian,
          primarySignal: "commit_to_deploy",
        },
        tier: tierLeadTime(med),
        confidence: "high",
        evidenceSources: [
          "GitHub Deployment Statuses (success, production)",
          "GitHub Commits (sha linkage)",
        ],
        caveats:
          prFlowMedian !== null
            ? [`PR flow time (open→merge) is separately ${prFlowMedian}h median.`]
            : [],
      };
    }
  }

  // --- Fallback: PR flow time ---
  if (prFlowMedian !== null && merges.length >= 3) {
    const caveats = [
      "No production deployment + commit linkage found. Using PR open→merge time as a lead time proxy.",
      "DORA defines lead time as commit→production deploy, which may differ from PR flow time.",
    ];
    return {
      key: "changeLeadTime",
      value: {
        commitToDeployMedianHours: null,
        prFlowMedianHours: prFlowMedian,
        primarySignal: "pr_flow",
      },
      tier: tierLeadTime(prFlowMedian),
      confidence: "low",
      evidenceSources: ["GitHub Pull Requests (open→merge time)"],
      caveats,
    };
  }

  return {
    key: "changeLeadTime",
    value: {
      commitToDeployMedianHours: null,
      prFlowMedianHours: null,
      primarySignal: "insufficient",
    },
    tier: "Unknown",
    confidence: "unknown",
    evidenceSources: [],
    caveats: ["Insufficient PR or deployment history to compute lead time."],
  };
}
