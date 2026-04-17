// ============================================================================
// Metric Engine: Failed Deployment Recovery Time
// ============================================================================
// DORA definition: time from a failed production deployment to the next
// successful production deployment (i.e. recovery, not generic MTTR).
// ============================================================================

import type { EvidenceEvent } from "../domain/evidence.js";
import { isProductionEnvironment } from "../domain/evidence.js";
import type { MetricResult, FailedDeploymentRecoveryTimeValue } from "../domain/metrics.js";
import { tierRecoveryTime } from "../domain/metrics.js";
import type { RepoEvidenceProfile } from "../domain/repoProfile.js";
import { eventsByType } from "../normalize/githubEvidence.js";
import { median, percentile, differenceInHours } from "./shared.js";

export function computeFailedDeploymentRecoveryTime(
  events: EvidenceEvent[],
  profile: RepoEvidenceProfile,
): MetricResult<FailedDeploymentRecoveryTimeValue> {
  if (!profile.hasDeploymentStatuses || !profile.hasProductionDeployments) {
    const caveats: string[] = [];
    // Fallback: workflow run failure → next success (pipeline recovery, not DORA FDRT)
    if (profile.hasActionsRuns) {
      const runs = eventsByType(events, "WorkflowRunObserved")
        .filter((r) => r.status === "completed")
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

      const recoveryHours: number[] = [];
      for (let i = 0; i < runs.length; i++) {
        if (runs[i].conclusion === "failure") {
          for (let j = i + 1; j < runs.length; j++) {
            if (runs[j].conclusion === "success" && runs[j].workflowName === runs[i].workflowName) {
              const h = differenceInHours(new Date(runs[j].at), new Date(runs[i].at));
              if (h >= 0) {
                recoveryHours.push(h);
              }
              break;
            }
          }
        }
      }

      if (recoveryHours.length >= 2) {
        const med = +median(recoveryHours).toFixed(1);
        const p75 = +percentile(recoveryHours, 75).toFixed(1);
        caveats.push(
          "No production deployment status data found. Using workflow run failure→success recovery as a proxy. " +
            "DORA defines this metric in terms of production deployment recovery, not CI pipeline recovery.",
        );
        return {
          key: "failedDeploymentRecoveryTime",
          value: { medianHours: med, p75Hours: p75, sampleSize: recoveryHours.length },
          tier: tierRecoveryTime(med),
          confidence: "low",
          evidenceSources: ["GitHub Actions Workflow Runs (failure→success on same workflow)"],
          caveats,
        };
      }
    }

    return {
      key: "failedDeploymentRecoveryTime",
      value: null,
      tier: "Unknown",
      confidence: "unknown",
      evidenceSources: [],
      caveats: [
        "No production deployment status data found. Cannot compute Failed Deployment Recovery Time.",
      ],
    };
  }

  // Primary: production deployment statuses
  const prodStatuses = eventsByType(events, "DeploymentStatusObserved")
    .filter(
      (s) =>
        (s.state === "success" || s.state === "failure" || s.state === "error") &&
        s.environment !== null &&
        isProductionEnvironment(s.environment ?? ""),
    )
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // Group statuses by deploymentId; take the terminal state per deployment
  const terminalByDeployment = new Map<number, (typeof prodStatuses)[number]>();
  for (const s of prodStatuses) {
    // Later statuses overwrite earlier ones — last terminal state wins
    const existing = terminalByDeployment.get(s.deploymentId);
    if (!existing || new Date(s.at) > new Date(existing.at)) {
      terminalByDeployment.set(s.deploymentId, s);
    }
  }

  const terminal = [...terminalByDeployment.values()].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  const recoveryHours: number[] = [];
  for (let i = 0; i < terminal.length; i++) {
    if (terminal[i].state === "failure" || terminal[i].state === "error") {
      for (let j = i + 1; j < terminal.length; j++) {
        if (terminal[j].state === "success") {
          const h = differenceInHours(new Date(terminal[j].at), new Date(terminal[i].at));
          if (h >= 0) {
            recoveryHours.push(h);
          }
          break;
        }
      }
    }
  }

  if (recoveryHours.length < 2) {
    return {
      key: "failedDeploymentRecoveryTime",
      value: null,
      tier: "Unknown",
      confidence: recoveryHours.length === 1 ? "low" : "unknown",
      evidenceSources: ["GitHub Deployment Statuses (production)"],
      caveats: [
        recoveryHours.length === 0
          ? "No production deployment failures found in recent history."
          : "Only one recovery event found — insufficient for a reliable median.",
      ],
    };
  }

  const med = +median(recoveryHours).toFixed(1);
  const p75 = +percentile(recoveryHours, 75).toFixed(1);
  return {
    key: "failedDeploymentRecoveryTime",
    value: { medianHours: med, p75Hours: p75, sampleSize: recoveryHours.length },
    tier: tierRecoveryTime(med),
    confidence: "high",
    evidenceSources: ["GitHub Deployment Statuses (production, failure→success transitions)"],
    caveats: [],
  };
}
