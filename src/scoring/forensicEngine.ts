// ============================================================================
// Forensic Signal Engine
// ============================================================================
// Computes higher-order forensic signals from normalized evidence events.
// These go beyond DORA metrics to surface *why* a repo behaves the way it
// does — deploy burstiness, merge-to-deploy lag, pipeline flakiness, etc.
// ============================================================================

import type { EvidenceEvent } from "../domain/evidence.js";
import {
  isProductionEnvironment,
  isRollbackSignal,
  isHotfixSignal,
  isIncidentIssue,
  isConventionalCommit,
} from "../domain/evidence.js";
import type { RawContributor, RawBranchProtection } from "../domain/evidence.js";
import type { MetricSuite } from "../domain/metrics.js";
import type { ForensicSignal } from "../domain/forensics.js";
import type { DependencyVulnerability } from "../types/index.js";
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
// Layer 2 decision signal detectors
// ---------------------------------------------------------------------------

const REVIEW_LATENCY_WARN_HOURS = 48;
const REWORK_DENSITY_WARN_PCT = 15;
const MAINTAINER_CONCENTRATION_WARN = 0.7; // single contributor > 70% of commits
const FRESHNESS_WARN_DAYS = 90;
const CI_FLAKINESS_WARN_PCT = 15;

function detectReleaseHygiene(events: EvidenceEvent[]): ForensicSignal | null {
  const releases = events.filter((e) => e.type === "ReleasePublished");
  const commits = events.filter((e) => e.type === "CommitObserved");

  if (commits.length < 10) {
    return null;
  }

  // Check for semantic versioning
  const semverRe = /^v?\d+\.\d+\.\d+/;
  const semverCount = releases.filter(
    (r) => r.type === "ReleasePublished" && semverRe.test(r.tagName),
  ).length;

  // Check for conventional commits
  const conventionalCount = commits.filter(
    (c) => c.type === "CommitObserved" && isConventionalCommit(c.message),
  ).length;
  const conventionalPct = Math.round((conventionalCount / commits.length) * 100);

  // No releases at all is a hygiene problem
  if (releases.length === 0) {
    return {
      id: "release-hygiene",
      title: "No tagged releases found",
      severity: "warning",
      evidence: `0 releases found. ${conventionalPct}% conventional commits (${conventionalCount}/${commits.length})`,
      metric: 0,
      threshold: 1,
      recommendation:
        "Tag releases with semantic versions — consumers need version anchors to depend on this safely",
    };
  }

  const nonSemverPct =
    releases.length > 0 ? Math.round(((releases.length - semverCount) / releases.length) * 100) : 0;
  if (nonSemverPct > 50 || conventionalPct < 30) {
    return {
      id: "release-hygiene",
      title: "Weak release hygiene",
      severity: "info",
      evidence: `${nonSemverPct}% of releases lack semver tags. ${conventionalPct}% conventional commits`,
      metric: conventionalPct,
      threshold: 30,
      recommendation:
        "Adopt semantic versioning and conventional commits — it makes changelogs automatable and dependencies predictable",
    };
  }

  return null;
}

function detectRollbackSignal(events: EvidenceEvent[]): ForensicSignal | null {
  const merges = events.filter((e) => e.type === "PullRequestMerged");
  if (merges.length < 5) {
    return null;
  }

  const rollbacks = merges.filter(
    (e) => e.type === "PullRequestMerged" && isRollbackSignal(e.title, e.labels),
  ).length;
  const hotfixes = merges.filter(
    (e) => e.type === "PullRequestMerged" && isHotfixSignal(e.title, e.labels),
  ).length;

  const reworkCount = rollbacks + hotfixes;
  const reworkPct = Math.round((reworkCount / merges.length) * 100);

  if (reworkPct < REWORK_DENSITY_WARN_PCT) {
    return null;
  }

  return {
    id: "rollback-signal",
    title: "Frequent rollbacks or hotfixes",
    severity: reworkPct > 30 ? "critical" : "warning",
    evidence: `${reworkPct}% of merged PRs are rollbacks (${rollbacks}) or hotfixes (${hotfixes}) out of ${merges.length} total`,
    metric: reworkPct,
    threshold: REWORK_DENSITY_WARN_PCT,
    recommendation:
      "Add pre-merge validation (staging deploys, canary checks) to catch issues before they reach production",
  };
}

function detectMaintainerConcentration(contributors: RawContributor[]): ForensicSignal | null {
  if (contributors.length < 2) {
    if (contributors.length === 1) {
      return {
        id: "maintainer-concentration",
        title: "Single maintainer — bus factor = 1",
        severity: "warning",
        evidence: `Only 1 contributor found. All commits come from a single author`,
        metric: 100,
        threshold: Math.round(MAINTAINER_CONCENTRATION_WARN * 100),
        recommendation:
          "Recruit co-maintainers or document onboarding paths to reduce key-person risk",
      };
    }
    return null;
  }

  const total = contributors.reduce((s, c) => s + c.contributions, 0);
  if (total === 0) {
    return null;
  }

  const sorted = [...contributors].sort((a, b) => b.contributions - a.contributions);
  const topShare = sorted[0].contributions / total;

  if (topShare <= MAINTAINER_CONCENTRATION_WARN) {
    return null;
  }

  return {
    id: "maintainer-concentration",
    title: "High maintainer concentration",
    severity: topShare > 0.9 ? "critical" : "warning",
    evidence: `Top contributor (${sorted[0].login}) owns ${Math.round(topShare * 100)}% of ${total} commits. ${contributors.length} total contributors`,
    metric: Math.round(topShare * 100),
    threshold: Math.round(MAINTAINER_CONCENTRATION_WARN * 100),
    recommendation:
      "Distribute ownership through CODEOWNERS, pair programming, and documented contribution guides",
  };
}

function detectIncidentRecoverability(events: EvidenceEvent[]): ForensicSignal | null {
  const closedIncidents = events.filter(
    (e) => e.type === "IssueClosed" && isIncidentIssue(e.labels),
  );

  if (closedIncidents.length < 3) {
    return null;
  }

  // Calculate median time-to-close for incident issues
  const resolutionHours: number[] = closedIncidents.map((e) => {
    if (e.type !== "IssueClosed") {
      return 0;
    }
    return differenceInHours(new Date(e.at), new Date(e.openedAt));
  });

  const sorted = [...resolutionHours].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  if (median <= 24) {
    return null; // incidents resolved within a day is fine
  }

  return {
    id: "incident-recoverability",
    title: "Slow incident resolution",
    severity: median > 72 ? "critical" : "warning",
    evidence: `Median incident issue resolution: ${Math.round(median)}h across ${closedIncidents.length} incidents`,
    metric: Math.round(median),
    threshold: 24,
    recommendation:
      "Establish incident response runbooks, on-call rotations, and automated alerting to reduce time-to-resolution",
  };
}

function detectDependencyExposure(vulns: DependencyVulnerability[]): ForensicSignal | null {
  if (vulns.length === 0) {
    return null;
  }

  const critical = vulns.filter((v) => v.severity === "critical").length;
  const high = vulns.filter((v) => v.severity === "high").length;
  const fixable = vulns.filter((v) => v.fixedVersion).length;
  const fixablePct = Math.round((fixable / vulns.length) * 100);

  if (critical === 0 && high === 0) {
    return null;
  }

  return {
    id: "dependency-exposure",
    title: "Known vulnerability exposure",
    severity: critical > 0 ? "critical" : "warning",
    evidence: `${critical} critical, ${high} high severity vulnerabilities. ${fixablePct}% have known fixes (${fixable}/${vulns.length})`,
    metric: critical + high,
    threshold: 1,
    recommendation:
      critical > 0
        ? `Upgrade ${critical} critical dependencies immediately — ${fixablePct}% have available fixes`
        : `Address ${high} high-severity vulnerabilities — most have published patches`,
  };
}

function detectReviewLatency(events: EvidenceEvent[]): ForensicSignal | null {
  const merged = events.filter((e) => e.type === "PullRequestMerged");
  if (merged.length < 5) {
    return null;
  }

  // PR open→merge as a proxy for review latency (includes review time)
  const latencies: number[] = merged.map((e) => {
    if (e.type !== "PullRequestMerged") {
      return 0;
    }
    return differenceInHours(new Date(e.at), new Date(e.openedAt));
  });

  const sorted = [...latencies].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  if (median <= REVIEW_LATENCY_WARN_HOURS) {
    return null;
  }

  return {
    id: "review-latency",
    title: "Slow PR review cycle",
    severity: median > 96 ? "critical" : "warning",
    evidence: `Median PR open→merge: ${Math.round(median)}h across ${merged.length} PRs`,
    metric: Math.round(median),
    threshold: REVIEW_LATENCY_WARN_HOURS,
    recommendation:
      "Set up CODEOWNERS for automatic reviewer assignment. Consider review SLAs and smaller PRs to reduce wait time",
  };
}

function detectReworkDensity(events: EvidenceEvent[]): ForensicSignal | null {
  const merges = events.filter((e) => e.type === "PullRequestMerged");
  if (merges.length < 10) {
    return null;
  }

  const reworkCount = merges.filter(
    (e) =>
      e.type === "PullRequestMerged" &&
      (isRollbackSignal(e.title, e.labels) || isHotfixSignal(e.title, e.labels)),
  ).length;

  const reworkPct = Math.round((reworkCount / merges.length) * 100);

  if (reworkPct < REWORK_DENSITY_WARN_PCT) {
    return null;
  }

  return {
    id: "rework-density",
    title: "High rework/hotfix density",
    severity: reworkPct > 25 ? "critical" : "warning",
    evidence: `${reworkPct}% of merged PRs are rework (rollbacks + hotfixes): ${reworkCount}/${merges.length}`,
    metric: reworkPct,
    threshold: REWORK_DENSITY_WARN_PCT,
    recommendation:
      "Invest in pre-merge testing (staging environments, integration tests, feature flags) to reduce post-deploy fixes",
  };
}

function detectFreshnessCadence(events: EvidenceEvent[]): ForensicSignal | null {
  const commits = events.filter((e) => e.type === "CommitObserved");
  const releases = events.filter((e) => e.type === "ReleasePublished");

  if (commits.length === 0) {
    return null;
  }

  // Check how recently the last commit was
  const sortedCommits = [...commits].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  const lastCommitAge = differenceInHours(new Date(), new Date(sortedCommits[0].at));
  const daysSinceLastCommit = lastCommitAge / 24;

  if (daysSinceLastCommit <= FRESHNESS_WARN_DAYS) {
    return null;
  }

  const lastRelease =
    releases.length > 0
      ? [...releases].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0]
      : null;

  const releaseInfo = lastRelease
    ? `. Last release: ${lastRelease.type === "ReleasePublished" ? lastRelease.tagName : "unknown"}`
    : ". No releases found";

  return {
    id: "freshness-cadence",
    title: "Stale repository — maintenance risk",
    severity: daysSinceLastCommit > 180 ? "critical" : "warning",
    evidence: `Last commit ${Math.round(daysSinceLastCommit)} days ago${releaseInfo}`,
    metric: Math.round(daysSinceLastCommit),
    threshold: FRESHNESS_WARN_DAYS,
    recommendation:
      "Evaluate whether this repo is actively maintained. Stale dependencies accumulate vulnerabilities over time",
  };
}

function detectCiFlakiness(events: EvidenceEvent[]): ForensicSignal | null {
  const runs = events.filter(
    (e) =>
      e.type === "WorkflowRunObserved" &&
      (e.conclusion === "success" || e.conclusion === "failure"),
  );

  if (runs.length < 10) {
    return null;
  }

  // Group by workflow name, look for workflows with high retry rates
  const byWorkflow = new Map<string, { successes: number; failures: number }>();
  for (const r of runs) {
    if (r.type !== "WorkflowRunObserved") {
      continue;
    }
    const name = r.workflowName ?? "unknown";
    const stats = byWorkflow.get(name) ?? { successes: 0, failures: 0 };
    if (r.conclusion === "success") {
      stats.successes++;
    } else {
      stats.failures++;
    }
    byWorkflow.set(name, stats);
  }

  // Find the worst workflow by failure percentage
  let worstName = "";
  let worstPct = 0;
  let totalFails = 0;
  let totalRuns = 0;

  for (const [name, stats] of byWorkflow) {
    const total = stats.successes + stats.failures;
    if (total < 5) {
      continue;
    }
    totalFails += stats.failures;
    totalRuns += total;
    const pct = Math.round((stats.failures / total) * 100);
    if (pct > worstPct) {
      worstPct = pct;
      worstName = name;
    }
  }

  const overallPct = totalRuns > 0 ? Math.round((totalFails / totalRuns) * 100) : 0;

  if (overallPct < CI_FLAKINESS_WARN_PCT) {
    return null;
  }

  return {
    id: "ci-flakiness",
    title: "CI reliability concerns",
    severity: overallPct > 30 ? "critical" : "warning",
    evidence: `${overallPct}% overall CI failure rate (${totalFails}/${totalRuns} runs)${worstName ? `. Worst: "${worstName}" at ${worstPct}%` : ""}`,
    metric: overallPct,
    threshold: CI_FLAKINESS_WARN_PCT,
    recommendation:
      "Quarantine flaky tests, add retry logic for infrastructure failures, and track CI reliability as a first-class metric",
  };
}

// ---------------------------------------------------------------------------
// Public: compute all forensic signals
// ---------------------------------------------------------------------------

export interface ForensicContext {
  events: EvidenceEvent[];
  metrics: MetricSuite;
  contributors?: RawContributor[];
  branchProtection?: RawBranchProtection | null;
  vulnerabilities?: DependencyVulnerability[];
}

export function computeForensicSignals(
  events: EvidenceEvent[],
  metrics: MetricSuite,
  context?: Partial<ForensicContext>,
): ForensicSignal[] {
  const signals: ForensicSignal[] = [];

  // Layer 1 detectors (original 6)
  const coreDetectors: Array<() => ForensicSignal | null> = [
    () => detectMergeToDeployLag(events),
    () => detectDeployBurstiness(events),
    () => detectFailedRunClustering(events),
    () => detectRecoveryAsymmetry(metrics),
    () => detectDeployDrought(events),
    () => detectFlakyPipeline(events),
  ];

  // Layer 2 decision signal detectors
  const decisionDetectors: Array<() => ForensicSignal | null> = [
    () => detectReleaseHygiene(events),
    () => detectRollbackSignal(events),
    () => detectReviewLatency(events),
    () => detectReworkDensity(events),
    () => detectFreshnessCadence(events),
    () => detectCiFlakiness(events),
    () => (context?.contributors ? detectMaintainerConcentration(context.contributors) : null),
    () => detectIncidentRecoverability(events),
    () => (context?.vulnerabilities ? detectDependencyExposure(context.vulnerabilities) : null),
  ];

  for (const detect of [...coreDetectors, ...decisionDetectors]) {
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
