// ============================================================================
// Forensic Signal Engine
// ============================================================================
// Computes higher-order forensic signals from normalized evidence events.
// These go beyond DORA metrics to surface *why* a repo behaves the way it
// does — deploy burstiness, merge-to-deploy lag, pipeline flakiness, etc.
// ============================================================================

import type { EvidenceEvent } from "../domain/evidence.js";
import { isProductionEnvironment } from "../domain/evidence.js";
import type { MetricSuite } from "../domain/metrics.js";
import type { ForensicSignal } from "../domain/forensics.js";
import { differenceInHours } from "../metrics/shared.js";

// ---------------------------------------------------------------------------
// Thresholds (configurable later via policy)
// ---------------------------------------------------------------------------

const MERGE_TO_DEPLOY_LAG_HOURS = 48;
const DEPLOY_BURSTINESS_CV_THRESHOLD = 1.5; // coefficient of variation
const FAILED_RUN_CLUSTERING_THRESHOLD = 0.5; // >50% of failures on single day
const RECOVERY_ASYMMETRY_RATIO = 3; // recovery > 3× lead time
const DEPLOY_DROUGHT_DAYS = 14;
const FLAKY_PIPELINE_OSCILLATION_RATE = 0.3; // >30% fail→pass→fail transitions

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function stddev(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// Individual signal detectors
// ---------------------------------------------------------------------------

function detectMergeToDeployLag(events: EvidenceEvent[]): ForensicSignal | null {
  const merges = events.filter((e) => e.type === "PullRequestMerged");
  const prodDeploys = events.filter(
    (e) =>
      e.type === "DeploymentStatusObserved" &&
      e.state === "success" &&
      e.environment !== null &&
      isProductionEnvironment(e.environment),
  );

  if (merges.length === 0 || prodDeploys.length === 0) {
    return null;
  }

  // For each merge, find the next production deployment after it
  const lags: number[] = [];
  for (const merge of merges) {
    const mergeTime = new Date(merge.at).getTime();
    const nextDeploy = prodDeploys.find((d) => new Date(d.at).getTime() > mergeTime);
    if (nextDeploy) {
      lags.push(differenceInHours(new Date(nextDeploy.at), new Date(merge.at)));
    }
  }

  if (lags.length < 2) {
    return null;
  }

  const sorted = [...lags].sort((a, b) => a - b);
  const medianLag = sorted[Math.floor(sorted.length / 2)];

  if (medianLag <= MERGE_TO_DEPLOY_LAG_HOURS) {
    return null;
  }

  return {
    id: "merge-to-deploy-lag",
    title: "Slow merge-to-deploy pipeline",
    severity: medianLag > 96 ? "critical" : "warning",
    evidence: `Median ${Math.round(medianLag)}h between PR merge and production deployment (${lags.length} samples)`,
    metric: Math.round(medianLag),
    threshold: MERGE_TO_DEPLOY_LAG_HOURS,
    recommendation:
      "Automate deployment triggers on merge to main — CD should not require manual intervention",
  };
}

function detectDeployBurstiness(events: EvidenceEvent[]): ForensicSignal | null {
  const deploys = events.filter(
    (e) => e.type === "DeploymentObserved" || e.type === "DeploymentStatusObserved",
  );

  if (deploys.length < 5) {
    return null;
  }

  // Group by day
  const byDay = new Map<string, number>();
  for (const d of deploys) {
    const day = dayKey(d.at);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const counts = Array.from(byDay.values());
  const mean = counts.reduce((s, v) => s + v, 0) / counts.length;
  if (mean === 0) {
    return null;
  }

  const cv = stddev(counts) / mean; // coefficient of variation

  if (cv <= DEPLOY_BURSTINESS_CV_THRESHOLD) {
    return null;
  }

  const maxDay = Math.max(...counts);
  return {
    id: "deploy-burstiness",
    title: "Bursty deployment pattern",
    severity: "warning",
    evidence: `Deploy frequency varies wildly (CV=${cv.toFixed(2)}). Peak day had ${maxDay} deploys vs mean ${mean.toFixed(1)}/day`,
    metric: Math.round(cv * 100) / 100,
    threshold: DEPLOY_BURSTINESS_CV_THRESHOLD,
    recommendation:
      "Spread deployments more evenly — bursty releases correlate with higher failure rates",
  };
}

function detectFailedRunClustering(events: EvidenceEvent[]): ForensicSignal | null {
  const failedRuns = events.filter(
    (e) => e.type === "WorkflowRunObserved" && e.conclusion === "failure",
  );

  if (failedRuns.length < 5) {
    return null;
  }

  // Group failures by day-of-week (0=Sunday ... 6=Saturday)
  const byDow = new Map<number, number>();
  for (const r of failedRuns) {
    const dow = new Date(r.at).getDay();
    byDow.set(dow, (byDow.get(dow) ?? 0) + 1);
  }

  const total = failedRuns.length;
  const peakDow = Array.from(byDow.entries()).sort((a, b) => b[1] - a[1])[0];
  const peakFraction = peakDow[1] / total;

  if (peakFraction <= FAILED_RUN_CLUSTERING_THRESHOLD) {
    return null;
  }

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return {
    id: "failed-run-clustering",
    title: "Pipeline failures cluster on specific days",
    severity: "warning",
    evidence: `${Math.round(peakFraction * 100)}% of pipeline failures (${peakDow[1]}/${total}) occur on ${dayNames[peakDow[0]]}`,
    metric: Math.round(peakFraction * 100),
    threshold: Math.round(FAILED_RUN_CLUSTERING_THRESHOLD * 100),
    recommendation:
      "Investigate environment-specific issues on peak failure days — may indicate scheduled jobs, resource contention, or deploy timing",
  };
}

function detectRecoveryAsymmetry(metrics: MetricSuite): ForensicSignal | null {
  const recovery = metrics.failedDeploymentRecoveryTime.value;
  const leadTime = metrics.changeLeadTime.value;

  if (!recovery || !leadTime) {
    return null;
  }

  const leadHours = leadTime.commitToDeployMedianHours ?? leadTime.prFlowMedianHours;
  if (!leadHours || leadHours === 0) {
    return null;
  }

  const ratio = recovery.medianHours / leadHours;

  if (ratio <= RECOVERY_ASYMMETRY_RATIO) {
    return null;
  }

  return {
    id: "recovery-asymmetry",
    title: "Recovery is much slower than shipping",
    severity: ratio > 10 ? "critical" : "warning",
    evidence: `Recovery takes ${recovery.medianHours.toFixed(1)}h vs ${leadHours.toFixed(1)}h lead time (${ratio.toFixed(1)}× slower)`,
    metric: Math.round(ratio * 10) / 10,
    threshold: RECOVERY_ASYMMETRY_RATIO,
    recommendation:
      "Strengthen incident response: pre-built rollback workflows, deployment health checks, and automated canary releases",
  };
}

function detectDeployDrought(events: EvidenceEvent[]): ForensicSignal | null {
  const deploys = events
    .filter((e) => e.type === "DeploymentObserved" || e.type === "DeploymentStatusObserved")
    .map((e) => new Date(e.at).getTime())
    .sort((a, b) => a - b);

  if (deploys.length < 2) {
    return null;
  }

  // Find the longest gap between consecutive deployments
  let maxGapMs = 0;
  let gapStart = 0;
  for (let i = 1; i < deploys.length; i++) {
    const gap = deploys[i] - deploys[i - 1];
    if (gap > maxGapMs) {
      maxGapMs = gap;
      gapStart = deploys[i - 1];
    }
  }

  const maxGapDays = maxGapMs / (1000 * 60 * 60 * 24);

  if (maxGapDays <= DEPLOY_DROUGHT_DAYS) {
    return null;
  }

  const gapDate = new Date(gapStart).toISOString().slice(0, 10);
  return {
    id: "deploy-drought",
    title: "Extended deployment drought detected",
    severity: maxGapDays > 30 ? "critical" : "warning",
    evidence: `Longest gap without deployment: ${Math.round(maxGapDays)} days (starting ${gapDate})`,
    metric: Math.round(maxGapDays),
    threshold: DEPLOY_DROUGHT_DAYS,
    recommendation:
      "Long deployment pauses often mean batched releases — ship smaller, more frequent changes to reduce blast radius",
  };
}

function detectFlakyPipeline(events: EvidenceEvent[]): ForensicSignal | null {
  // Group workflow runs by workflow name, sorted chronologically
  const runs = events
    .filter((e) => e.type === "WorkflowRunObserved" && e.conclusion !== null)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  if (runs.length < 10) {
    return null;
  }

  // Group by workflow name
  const byWorkflow = new Map<string, string[]>();
  for (const r of runs) {
    if (r.type !== "WorkflowRunObserved" || !r.conclusion) {
      continue;
    }
    const name = r.workflowName ?? "unknown";
    const existing = byWorkflow.get(name) ?? [];
    existing.push(r.conclusion);
    byWorkflow.set(name, existing);
  }

  // Detect oscillation: count fail→success→fail or success→fail→success transitions
  let totalTransitions = 0;
  let oscillations = 0;
  let flakyWorkflow: string | null = null;
  let maxOscillationRate = 0;

  for (const [name, conclusions] of byWorkflow) {
    if (conclusions.length < 5) {
      continue;
    }
    let wfOscillations = 0;
    let wfTransitions = 0;
    for (let i = 2; i < conclusions.length; i++) {
      wfTransitions++;
      if (
        conclusions[i] !== conclusions[i - 1] &&
        conclusions[i - 1] !== conclusions[i - 2] &&
        conclusions[i] === conclusions[i - 2]
      ) {
        wfOscillations++;
      }
    }
    totalTransitions += wfTransitions;
    oscillations += wfOscillations;
    const rate = wfTransitions > 0 ? wfOscillations / wfTransitions : 0;
    if (rate > maxOscillationRate) {
      maxOscillationRate = rate;
      flakyWorkflow = name;
    }
  }

  if (totalTransitions === 0) {
    return null;
  }

  const overallRate = oscillations / totalTransitions;
  if (overallRate <= FLAKY_PIPELINE_OSCILLATION_RATE) {
    return null;
  }

  return {
    id: "flaky-pipeline",
    title: "Flaky pipeline suspected",
    severity: overallRate > 0.5 ? "critical" : "warning",
    evidence: `${Math.round(overallRate * 100)}% oscillation rate across ${totalTransitions} transitions${flakyWorkflow ? ` (worst: "${flakyWorkflow}")` : ""}`,
    metric: Math.round(overallRate * 100),
    threshold: Math.round(FLAKY_PIPELINE_OSCILLATION_RATE * 100),
    recommendation:
      "Identify and quarantine flaky tests — use retry detection, test impact analysis, and separate flaky suites from critical path",
  };
}

// ---------------------------------------------------------------------------
// Public: compute all forensic signals
// ---------------------------------------------------------------------------

export function computeForensicSignals(
  events: EvidenceEvent[],
  metrics: MetricSuite,
): ForensicSignal[] {
  const signals: ForensicSignal[] = [];

  const detectors: Array<() => ForensicSignal | null> = [
    () => detectMergeToDeployLag(events),
    () => detectDeployBurstiness(events),
    () => detectFailedRunClustering(events),
    () => detectRecoveryAsymmetry(metrics),
    () => detectDeployDrought(events),
    () => detectFlakyPipeline(events),
  ];

  for (const detect of detectors) {
    const signal = detect();
    if (signal) {
      signals.push(signal);
    }
  }

  // Sort: critical first, then warning, then info
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  signals.sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));

  return signals;
}
