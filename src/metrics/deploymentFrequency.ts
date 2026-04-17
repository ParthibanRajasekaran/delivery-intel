// ============================================================================
// Metric Engine: Deployment Frequency
// ============================================================================
// Evidence priority:
//   1. Successful production deployment statuses (confidence: high)
//   2. Deployments with production environment (confidence: medium)
//   3. All deployments regardless of environment (confidence: medium)
//   4. Release-triggered workflow runs (confidence: low)
//   5. Merged PRs to default branch (confidence: low)
// ============================================================================

import type { EvidenceEvent } from "../domain/evidence.js";
import { isProductionEnvironment } from "../domain/evidence.js";
import type { MetricResult, DeploymentFrequencyValue } from "../domain/metrics.js";
import { tierDeployFreq } from "../domain/metrics.js";
import type { RepoEvidenceProfile } from "../domain/repoProfile.js";
import { eventsByType } from "../normalize/githubEvidence.js";

const _WEEKS_PER_MONTH = 52 / 12;

function deploymentsPerWeek(count: number, spanDays: number): number {
  if (spanDays <= 0 || count === 0) {
    return 0;
  }
  return count / (spanDays / 7);
}

function spanDays(dates: Date[]): number {
  if (dates.length < 2) {
    return 7;
  } // assume 1-week window for single event
  const times = dates.map((d) => d.getTime());
  return (Math.max(...times) - Math.min(...times)) / (1000 * 60 * 60 * 24);
}

export function computeDeploymentFrequency(
  events: EvidenceEvent[],
  profile: RepoEvidenceProfile,
): MetricResult<DeploymentFrequencyValue> {
  const caveats: string[] = [];
  const evidenceSources: string[] = [];

  // --- Strategy 1: successful prod deployment statuses ---
  if (profile.hasDeploymentStatuses && profile.hasProductionDeployments) {
    const statuses = eventsByType(events, "DeploymentStatusObserved").filter(
      (s) =>
        s.state === "success" &&
        s.environment !== null &&
        isProductionEnvironment(s.environment ?? ""),
    );
    if (statuses.length >= 2) {
      const dates = statuses.map((s) => new Date(s.at));
      const sd = spanDays(dates);
      const freq = deploymentsPerWeek(dates.length, sd);
      evidenceSources.push("GitHub Deployment Statuses (production, success)");
      return {
        key: "deploymentFrequency",
        value: { deploymentsPerWeek: +freq.toFixed(2), signalType: "deployment_statuses" },
        tier: tierDeployFreq(freq),
        confidence: "high",
        evidenceSources,
        caveats,
        isInferred: false,
        coverage: { sampleSize: statuses.length, windowDays: Math.round(sd) },
        assumptions: [],
        howToImproveAccuracy: [],
      };
    }
  }

  // --- Strategy 2: all deployments with prod environment ---
  if (profile.hasProductionDeployments) {
    const deploys = eventsByType(events, "DeploymentObserved").filter((d) =>
      isProductionEnvironment(d.environment),
    );
    if (deploys.length >= 2) {
      const dates = deploys.map((d) => new Date(d.at));
      const sd = spanDays(dates);
      const freq = deploymentsPerWeek(deploys.length, sd);
      evidenceSources.push("GitHub Deployments API (production environment)");
      caveats.push(
        "Deployment status (success/failure) not available; counting all prod deployments.",
      );
      return {
        key: "deploymentFrequency",
        value: { deploymentsPerWeek: +freq.toFixed(2), signalType: "deployments_api" },
        tier: tierDeployFreq(freq),
        confidence: "medium",
        evidenceSources,
        caveats,
        isInferred: false,
        coverage: { sampleSize: deploys.length, windowDays: Math.round(sd) },
        assumptions: [
          "All production-environment deployments are counted, regardless of success/failure status.",
        ],
        howToImproveAccuracy: [
          "Emit deployment status updates (success/failure) from your CI/CD pipeline to enable confidence: high.",
        ],
      };
    }
  }

  // --- Strategy 3: any deployments (no prod environment filter) ---
  if (profile.hasDeploymentsApiData) {
    const deploys = eventsByType(events, "DeploymentObserved");
    if (deploys.length >= 2) {
      const dates = deploys.map((d) => new Date(d.at));
      const sd = spanDays(dates);
      const freq = deploymentsPerWeek(deploys.length, sd);
      evidenceSources.push("GitHub Deployments API (all environments)");
      caveats.push(
        "No production-specific environment found. Counting all deployment environments.",
      );
      return {
        key: "deploymentFrequency",
        value: { deploymentsPerWeek: +freq.toFixed(2), signalType: "deployments_api" },
        tier: tierDeployFreq(freq),
        confidence: "medium",
        evidenceSources,
        caveats,
        isInferred: false,
        coverage: { sampleSize: deploys.length, windowDays: Math.round(sd) },
        assumptions: [
          "No 'production' environment label found — counting all environments as a proxy.",
        ],
        howToImproveAccuracy: [
          "Name your deployment environment 'production', 'prod', or 'live' to enable production-only filtering.",
        ],
      };
    }
  }

  // --- Strategy 4: merged PRs fallback ---
  if (profile.hasMergedPrHistory) {
    const merges = eventsByType(events, "PullRequestMerged");
    if (merges.length >= 2) {
      const dates = merges.map((m) => new Date(m.at));
      const sd = spanDays(dates);
      const freq = deploymentsPerWeek(merges.length, sd);
      evidenceSources.push("GitHub Pull Requests (merged, used as deployment proxy)");
      caveats.push(
        "No GitHub Deployment data found. Using merged PRs as a proxy for deployment frequency. " +
          "This may overstate actual production deployments if not all merges trigger a deploy.",
      );
      return {
        key: "deploymentFrequency",
        value: { deploymentsPerWeek: +freq.toFixed(2), signalType: "merged_prs" },
        tier: tierDeployFreq(freq),
        confidence: "low",
        evidenceSources,
        caveats,
        isInferred: true,
        coverage: { sampleSize: merges.length, windowDays: Math.round(sd) },
        assumptions: [
          "Every merged PR is assumed to trigger a production deployment.",
          "Repos that batch releases or require manual gates will show inflated frequency.",
        ],
        howToImproveAccuracy: [
          "Add a deploy workflow that emits GitHub deployment events (see Fix Pack: missing-deployment-tracking).",
        ],
      };
    }
  }

  // --- Insufficient evidence ---
  return {
    key: "deploymentFrequency",
    value: { deploymentsPerWeek: 0, signalType: "insufficient" },
    tier: "Unknown",
    confidence: "unknown",
    evidenceSources: [],
    caveats: ["Insufficient deployment or PR history to compute deployment frequency."],
    isInferred: true,
    coverage: { sampleSize: 0, windowDays: 0 },
    assumptions: [],
    howToImproveAccuracy: [
      "Add GitHub deployment events or ensure PRs are merged to the default branch.",
    ],
  };
}

/**
 * Bucket deployment events into per-day counts for the last 7 days.
 * Used by the CLI sparkline and dashboard chart.
 */
export function deploymentDailyBuckets(events: EvidenceEvent[]): number[] {
  const deploys = eventsByType(events, "DeploymentObserved");
  const dates = deploys.map((d) => new Date(d.at));
  const now = new Date();
  const buckets = new Array<number>(7).fill(0);
  for (const d of dates) {
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays < 7) {
      buckets[6 - diffDays]++;
    }
  }
  return buckets;
}
