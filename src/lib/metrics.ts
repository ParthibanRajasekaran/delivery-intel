// ============================================================================
// DORA Metrics Calculation Engine
// ============================================================================
// Computes the four key DORA metrics with fallback logic for repos that don't
// use the formal GitHub Deployments API.
// ============================================================================

import {
  differenceInHours,
  differenceInCalendarWeeks,
  parseISO,
} from "date-fns";
import type {
  RepoIdentifier,
  DORAMetrics,
  GitHubWorkflowRun,
  GitHubDeployment,
  GitHubDeploymentStatus,
  GitHubPullRequest,
  GQLPullRequestsResponse,
} from "@/types";
import {
  fetchWorkflowRuns,
  fetchDeployments,
  fetchDeploymentStatuses,
  fetchMergedPullRequests,
  fetchPRsWithDeployments,
} from "./github";

// ---------------------------------------------------------------------------
// Rating thresholds (based on DORA State of DevOps benchmarks)
// ---------------------------------------------------------------------------

function rateDeploymentFrequency(
  perWeek: number
): DORAMetrics["deploymentFrequency"]["rating"] {
  if (perWeek >= 7) return "Elite";       // multiple per day
  if (perWeek >= 1) return "High";        // at least weekly
  if (perWeek >= 0.25) return "Medium";   // at least monthly
  return "Low";
}

function rateLeadTime(
  medianHours: number
): DORAMetrics["leadTimeForChanges"]["rating"] {
  if (medianHours < 24) return "Elite";
  if (medianHours < 168) return "High";   // < 1 week
  if (medianHours < 720) return "Medium"; // < 1 month
  return "Low";
}

function rateChangeFailureRate(
  pct: number
): DORAMetrics["changeFailureRate"]["rating"] {
  if (pct <= 5) return "Elite";
  if (pct <= 10) return "High";
  if (pct <= 15) return "Medium";
  return "Low";
}

function rateMTTR(
  hours: number | null
): DORAMetrics["meanTimeToRestore"]["rating"] {
  if (hours === null) return "N/A";
  if (hours < 1) return "Elite";
  if (hours < 24) return "High";
  if (hours < 168) return "Medium";
  return "Low";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// 1) Deployment Frequency  (with merged-PR fallback)
// ---------------------------------------------------------------------------

async function computeDeploymentFrequency(
  id: RepoIdentifier
): Promise<DORAMetrics["deploymentFrequency"]> {
  // Attempt #1: Use the formal Deployments API
  const deployments: GitHubDeployment[] = await fetchDeployments(id, 50);

  if (deployments.length >= 2) {
    const dates = deployments.map((d) => parseISO(d.created_at));
    const weeks =
      differenceInCalendarWeeks(dates[0], dates[dates.length - 1]) || 1;
    const perWeek = +(deployments.length / weeks).toFixed(2);
    return {
      deploymentsPerWeek: perWeek,
      rating: rateDeploymentFrequency(perWeek),
      source: "deployments_api",
    };
  }

  // Fallback: Count merged PRs to default branch as "deploys"
  const mergedPRs: GitHubPullRequest[] = await fetchMergedPullRequests(id, 50);
  if (mergedPRs.length < 2) {
    return {
      deploymentsPerWeek: 0,
      rating: "Low",
      source: "merged_prs_fallback",
    };
  }

  const prDates = mergedPRs
    .map((pr) => parseISO(pr.merged_at!))
    .sort((a, b) => b.getTime() - a.getTime());

  const weeks =
    differenceInCalendarWeeks(prDates[0], prDates[prDates.length - 1]) || 1;
  const perWeek = +(mergedPRs.length / weeks).toFixed(2);

  return {
    deploymentsPerWeek: perWeek,
    rating: rateDeploymentFrequency(perWeek),
    source: "merged_prs_fallback",
  };
}

// ---------------------------------------------------------------------------
// 2) Lead Time for Changes
// ---------------------------------------------------------------------------

async function computeLeadTime(
  id: RepoIdentifier
): Promise<DORAMetrics["leadTimeForChanges"]> {
  // Lead Time = how long a branch/PR was active (PR created → PR merged)
  const mergedPRs = await fetchMergedPullRequests(id, 30);
  const hours = mergedPRs
    .filter((pr) => pr.merged_at)
    .map((pr) =>
      differenceInHours(parseISO(pr.merged_at!), parseISO(pr.created_at))
    );
  const med = median(hours);
  return { medianHours: +med.toFixed(1), rating: rateLeadTime(med) };
}

// ---------------------------------------------------------------------------
// 3) Change Failure Rate
// ---------------------------------------------------------------------------

async function computeChangeFailureRate(
  id: RepoIdentifier
): Promise<DORAMetrics["changeFailureRate"]> {
  const runs: GitHubWorkflowRun[] = await fetchWorkflowRuns(id, 50);

  if (runs.length === 0) {
    return { percentage: 0, failedRuns: 0, totalRuns: 0, rating: "Elite" };
  }

  // Only consider completed runs (ignore in_progress / queued)
  const completed = runs.filter((r) => r.status === "completed");
  if (completed.length === 0) {
    return { percentage: 0, failedRuns: 0, totalRuns: 0, rating: "Elite" };
  }

  const failures = completed.filter((r) => r.conclusion === "failure");
  const pct = +((failures.length / completed.length) * 100).toFixed(1);

  return {
    percentage: pct,
    failedRuns: failures.length,
    totalRuns: completed.length,
    rating: rateChangeFailureRate(pct),
  };
}

// ---------------------------------------------------------------------------
// 4) Mean Time to Restore (MTTR)
// ---------------------------------------------------------------------------

async function computeMTTR(
  id: RepoIdentifier
): Promise<DORAMetrics["meanTimeToRestore"]> {
  const runs: GitHubWorkflowRun[] = await fetchWorkflowRuns(id, 100);

  // Sort chronologically (oldest first)
  const sorted = [...runs].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const restorationTimes: number[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (
      sorted[i].status === "completed" &&
      sorted[i].conclusion === "failure"
    ) {
      // Find the next successful run on the same branch
      const failedRun = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        if (
          sorted[j].status === "completed" &&
          sorted[j].conclusion === "success" &&
          sorted[j].head_branch === failedRun.head_branch
        ) {
          const hours = differenceInHours(
            parseISO(sorted[j].created_at),
            parseISO(failedRun.created_at)
          );
          restorationTimes.push(hours);
          break;
        }
      }
    }
  }

  if (restorationTimes.length === 0) {
    return { medianHours: null, rating: "N/A" };
  }

  const med = median(restorationTimes);
  return { medianHours: +med.toFixed(1), rating: rateMTTR(med) };
}

// ---------------------------------------------------------------------------
// Public: Compute all DORA metrics
// ---------------------------------------------------------------------------

export async function computeDORAMetrics(
  id: RepoIdentifier
): Promise<DORAMetrics> {
  const [deploymentFrequency, leadTimeForChanges, changeFailureRate] =
    await Promise.all([
      computeDeploymentFrequency(id),
      computeLeadTime(id),
      computeChangeFailureRate(id),
    ]);

  return {
    deploymentFrequency,
    leadTimeForChanges,
    changeFailureRate,
    // MTTR is kept in the type for completeness but not actively computed
    meanTimeToRestore: { medianHours: null, rating: "N/A" as const },
  };
}
