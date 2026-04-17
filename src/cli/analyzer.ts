// ============================================================================
// Delivery Intel — Standalone CLI Analyzer
// ============================================================================
// This module re-exports the core analysis logic without Next.js dependencies,
// so it can be used from the CLI or programmatically.
// ============================================================================

import type { Octokit } from "@octokit/rest";
import { differenceInHours, differenceInCalendarWeeks, parseISO } from "date-fns";
import {
  type ParsedDependency,
  parsePackageJson,
  parseRequirementsTxt,
} from "../shared/parsers.js";
import { scanDependencies } from "../shared/scanner.js";
import {
  type RepoIdentifier,
  createOctokit,
  parseRepoSlug,
  fetchDeployments,
  fetchMergedPRs,
  fetchWorkflowRuns,
  fetchFileContent,
} from "../shared/github.js";

// ---------------------------------------------------------------------------
// Types (self-contained, no @/ alias)
// ---------------------------------------------------------------------------

export { type RepoIdentifier, parseRepoSlug } from "../shared/github.js";

export interface DORAMetrics {
  deploymentFrequency: {
    deploymentsPerWeek: number;
    rating: string;
    source: "deployments_api" | "merged_prs_fallback";
  };
  leadTimeForChanges: {
    medianHours: number;
    rating: string;
  };
  changeFailureRate: {
    percentage: number;
    failedRuns: number;
    totalRuns: number;
    rating: string;
  };
}

export interface DependencyVulnerability {
  packageName: string;
  currentVersion: string;
  vulnId: string;
  summary: string;
  severity: string;
  aliases: string[];
  fixedVersion: string | null;
}

export interface Suggestion {
  category: "performance" | "reliability" | "security";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  actionItems: string[];
}

export interface TrendWindow {
  deploymentsPerWeek: number;
  leadTimeHours: number;
  changeFailureRate: number;
  score: number;
}

export interface TrendData {
  windowDays: number;
  current: TrendWindow;
  prior: TrendWindow;
  /** Positive delta = more deployments / lower failure rate = improving (sign is raw arithmetic). */
  deltas: {
    deploymentsPerWeek: number;
    leadTimeHours: number;
    changeFailureRate: number;
    score: number;
  };
}

export interface AnalysisResult {
  repo: RepoIdentifier;
  fetchedAt: string;
  doraMetrics: DORAMetrics;
  vulnerabilities: DependencyVulnerability[];
  suggestions: Suggestion[];
  overallScore: number;
  /** Deployment counts for the last 7 days (index 0 = 6 days ago, index 6 = today). */
  dailyDeployments: number[];
  /** Present only when --trend flag is passed. */
  trend?: TrendData;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function rateDeployFreq(v: number): string {
  if (v >= 7) {
    return "Elite";
  }
  if (v >= 1) {
    return "High";
  }
  if (v >= 0.25) {
    return "Medium";
  }
  return "Low";
}
function rateLeadTime(h: number): string {
  if (h < 24) {
    return "Elite";
  }
  if (h < 168) {
    return "High";
  }
  if (h < 720) {
    return "Medium";
  }
  return "Low";
}
function rateCFR(p: number): string {
  if (p <= 5) {
    return "Elite";
  }
  if (p <= 10) {
    return "High";
  }
  if (p <= 15) {
    return "Medium";
  }
  return "Low";
}

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

/**
 * Bucket a list of ISO-date events into per-day counts for the last 7 days.
 * Returns an array of length 7 where index 0 = 6 days ago and index 6 = today.
 */
export function bucketLast7Days(dates: Date[]): number[] {
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

async function computeDeployFrequency(
  octokit: Octokit,
  id: RepoIdentifier,
): Promise<{ freq: DORAMetrics["deploymentFrequency"]; daily: number[] }> {
  const deployments = await fetchDeployments(octokit, id);
  if (deployments.length >= 2) {
    const dates = deployments.map((d: any) => parseISO(d.created_at));
    const weeks = differenceInCalendarWeeks(dates[0], dates[dates.length - 1]) || 1;
    const perWeek = +(deployments.length / weeks).toFixed(2);
    return {
      freq: {
        deploymentsPerWeek: perWeek,
        rating: rateDeployFreq(perWeek),
        source: "deployments_api",
      },
      daily: bucketLast7Days(dates),
    };
  }

  const mergedPRs = await fetchMergedPRs(octokit, id);
  if (mergedPRs.length < 2) {
    return {
      freq: { deploymentsPerWeek: 0, rating: "Low", source: "merged_prs_fallback" },
      daily: new Array(7).fill(0),
    };
  }
  const prDates = mergedPRs
    .map((pr: any) => parseISO(pr.merged_at))
    .sort((a: Date, b: Date) => b.getTime() - a.getTime());
  const weeks = differenceInCalendarWeeks(prDates[0], prDates[prDates.length - 1]) || 1;
  const perWeek = +(mergedPRs.length / weeks).toFixed(2);
  return {
    freq: {
      deploymentsPerWeek: perWeek,
      rating: rateDeployFreq(perWeek),
      source: "merged_prs_fallback",
    },
    daily: bucketLast7Days(prDates),
  };
}

async function computeLeadTime(
  octokit: Octokit,
  id: RepoIdentifier,
): Promise<DORAMetrics["leadTimeForChanges"]> {
  const mergedPRs = await fetchMergedPRs(octokit, id);
  const hours = mergedPRs
    .filter((pr: any) => pr.merged_at)
    .map((pr: any) => differenceInHours(parseISO(pr.merged_at), parseISO(pr.created_at)));
  if (hours.length === 0) {
    return { medianHours: 0, rating: "N/A" };
  }
  const med = median(hours);
  return { medianHours: +med.toFixed(1), rating: rateLeadTime(med) };
}

async function computeCFR(
  octokit: Octokit,
  id: RepoIdentifier,
): Promise<DORAMetrics["changeFailureRate"]> {
  const runs = await fetchWorkflowRuns(octokit, id);
  if (runs.length === 0) {
    return { percentage: 0, failedRuns: 0, totalRuns: 0, rating: "N/A" };
  }
  const completed = runs.filter((r: any) => r.status === "completed");
  if (completed.length === 0) {
    return { percentage: 0, failedRuns: 0, totalRuns: 0, rating: "N/A" };
  }
  const failures = completed.filter((r: any) => r.conclusion === "failure");
  const pct = +((failures.length / completed.length) * 100).toFixed(1);
  return {
    percentage: pct,
    failedRuns: failures.length,
    totalRuns: completed.length,
    rating: rateCFR(pct),
  };
}

// ---------------------------------------------------------------------------
// Vulnerability scanning via OSV.dev (shared scanner)
// ---------------------------------------------------------------------------

async function scanVulnerabilities(
  octokit: Octokit,
  id: RepoIdentifier,
): Promise<DependencyVulnerability[]> {
  const [pkgJson, reqTxt] = await Promise.all([
    fetchFileContent(octokit, id, "package.json"),
    fetchFileContent(octokit, id, "requirements.txt"),
  ]);

  const allDeps: ParsedDependency[] = [];
  if (pkgJson) {
    allDeps.push(...parsePackageJson(pkgJson));
  }
  if (reqTxt) {
    allDeps.push(...parseRequirementsTxt(reqTxt));
  }

  return scanDependencies(allDeps);
}

// ---------------------------------------------------------------------------
// Suggestion engine
// ---------------------------------------------------------------------------

function generateSuggestions(dora: DORAMetrics, vulns: DependencyVulnerability[]): Suggestion[] {
  const suggestions: Suggestion[] = [];

  if (dora.changeFailureRate.percentage > 15) {
    suggestions.push({
      category: "reliability",
      severity: "high",
      title: "High Pipeline Failure Rate",
      description: `${dora.changeFailureRate.percentage}% failure rate (${dora.changeFailureRate.failedRuns}/${dora.changeFailureRate.totalRuns} runs). Above the 15% threshold.`,
      actionItems: [
        "Enable Branch Protection Rules requiring passing status checks.",
        "Add required code reviews before merging.",
        "Implement pre-merge CI: lint, type-check, unit tests.",
      ],
    });
  } else if (dora.changeFailureRate.percentage > 10) {
    suggestions.push({
      category: "reliability",
      severity: "medium",
      title: "Moderate Pipeline Failure Rate",
      description: `${dora.changeFailureRate.percentage}% failure rate. Room for improvement.`,
      actionItems: [
        "Review recent failures for common patterns.",
        "Add retry logic for flaky tests.",
      ],
    });
  }

  if (dora.leadTimeForChanges.medianHours > 168) {
    suggestions.push({
      category: "performance",
      severity: "high",
      title: "Slow Lead Time for Changes",
      description: `Median ${dora.leadTimeForChanges.medianHours}h (${(dora.leadTimeForChanges.medianHours / 24).toFixed(1)} days). Too long to merge.`,
      actionItems: [
        "Break features into smaller PRs (<400 lines).",
        "Set up CODEOWNERS for automatic review routing.",
        "Consider trunk-based development with feature flags.",
      ],
    });
  } else if (dora.leadTimeForChanges.medianHours > 48) {
    suggestions.push({
      category: "performance",
      severity: "medium",
      title: "PRs Sitting Too Long",
      description: `Median ${dora.leadTimeForChanges.medianHours}h. PRs may be waiting for review.`,
      actionItems: [
        "Set a team SLA for reviews (< 4 hours for first review).",
        "Use auto-assign to distribute review load.",
      ],
    });
  }

  if (dora.deploymentFrequency.rating === "Low" || dora.deploymentFrequency.rating === "N/A") {
    suggestions.push({
      category: "performance",
      severity: "medium",
      title: "Low Deployment Frequency",
      description: `Only ${dora.deploymentFrequency.deploymentsPerWeek}/week.`,
      actionItems: [
        "Set up continuous deployment for your default branch.",
        "Deploy smaller changes more frequently.",
      ],
    });
  }

  const critical = vulns.filter((v) => v.severity === "critical");
  const high = vulns.filter((v) => v.severity === "high");

  if (critical.length > 0) {
    suggestions.push({
      category: "security",
      severity: "high",
      title: `${critical.length} Critical Vulnerabilit${critical.length === 1 ? "y" : "ies"}`,
      description: `In: ${[...new Set(critical.map((v) => v.packageName))].join(", ")}`,
      actionItems: critical
        .filter((v) => v.fixedVersion)
        .map((v) => `Update ${v.packageName} → ${v.fixedVersion} (${v.vulnId})`),
    });
  }
  if (high.length > 0) {
    suggestions.push({
      category: "security",
      severity: "medium",
      title: `${high.length} High-Severity Vulnerabilit${high.length === 1 ? "y" : "ies"}`,
      description: `In: ${[...new Set(high.map((v) => v.packageName))].join(", ")}`,
      actionItems: high
        .filter((v) => v.fixedVersion)
        .map((v) => `Update ${v.packageName} → ${v.fixedVersion} (${v.vulnId})`),
    });
  }

  if (vulns.length === 0) {
    suggestions.push({
      category: "security",
      severity: "low",
      title: "No Known Vulnerabilities",
      description: "OSV.dev found no known issues. Keep dependencies updated.",
      actionItems: ["Enable Dependabot or Renovate for automated updates."],
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => order[a.severity] - order[b.severity]);
  return suggestions;
}

// ---------------------------------------------------------------------------
// Overall score
// ---------------------------------------------------------------------------

const SCORES: Record<string, number> = {
  Elite: 100,
  High: 75,
  Medium: 50,
  Low: 25,
  "N/A": 50,
};

function computeScore(dora: DORAMetrics, vulns: DependencyVulnerability[]): number {
  const doraScore =
    (SCORES[dora.deploymentFrequency.rating] +
      SCORES[dora.leadTimeForChanges.rating] +
      SCORES[dora.changeFailureRate.rating]) /
    3;

  const penalty = vulns.reduce((sum, v) => {
    if (v.severity === "critical") {
      return sum + 5;
    }
    if (v.severity === "high") {
      return sum + 2;
    }
    if (v.severity === "medium") {
      return sum + 1;
    }
    return sum;
  }, 0);

  return Math.max(0, Math.min(100, Math.round(doraScore - penalty)));
}

// ---------------------------------------------------------------------------
// Trend: compare last 30 days vs prior 30 days using same GitHub data
// ---------------------------------------------------------------------------

const TREND_WINDOW_DAYS = 30;
const TREND_WEEKS_PER_WINDOW = TREND_WINDOW_DAYS / 7;

/** Compute a window score from raw per-window metric values (no vuln penalty — consistent delta). */
function windowScore(freq: number, leadHours: number, cfr: number): number {
  const doraScore =
    (SCORES[rateDeployFreq(freq)] + SCORES[rateLeadTime(leadHours)] + SCORES[rateCFR(cfr)]) / 3;
  return Math.max(0, Math.min(100, Math.round(doraScore)));
}

// Minimal shapes needed from Octokit responses — cast once, no inline `any`.
interface RawDeploy {
  created_at: string;
}
interface RawPR {
  merged_at: string | null;
  created_at: string;
}
interface RawRun {
  status: string;
  conclusion: string | null;
  created_at: string;
}

export async function computeTrend(octokit: Octokit, id: RepoIdentifier): Promise<TrendData> {
  const now = new Date();
  const cutoffCurrent = new Date(now.getTime() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const cutoffPrior = new Date(now.getTime() - TREND_WINDOW_DAYS * 2 * 24 * 60 * 60 * 1000);

  const [rawDeploys, rawPRs, rawRuns] = await Promise.all([
    fetchDeployments(octokit, id, 200),
    fetchMergedPRs(octokit, id, 100),
    fetchWorkflowRuns(octokit, id, 200),
  ]);

  // Cast to minimal typed shapes once — avoids repeated `(x: any)` inline casts.
  const deploys = rawDeploys as unknown as RawDeploy[];
  const prs = rawPRs as unknown as RawPR[];
  const runs = rawRuns as unknown as RawRun[];

  // Split into current (last 30d) and prior (31-60d) windows
  const currentDeploys = deploys.filter((d) => new Date(d.created_at) >= cutoffCurrent);
  const priorDeploys = deploys.filter((d) => {
    const t = new Date(d.created_at);
    return t >= cutoffPrior && t < cutoffCurrent;
  });

  const currentPRs = prs.filter((pr) => pr.merged_at && new Date(pr.merged_at) >= cutoffCurrent);
  const priorPRs = prs.filter((pr) => {
    if (!pr.merged_at) {
      return false;
    }
    const t = new Date(pr.merged_at);
    return t >= cutoffPrior && t < cutoffCurrent;
  });

  const currentRuns = runs.filter(
    (r) => r.status === "completed" && new Date(r.created_at) >= cutoffCurrent,
  );
  const priorRuns = runs.filter((r) => {
    const t = new Date(r.created_at);
    return r.status === "completed" && t >= cutoffPrior && t < cutoffCurrent;
  });

  // Deployment frequency (fallback to merged PRs when no deployments)
  const currentFreq =
    currentDeploys.length > 0
      ? currentDeploys.length / TREND_WEEKS_PER_WINDOW
      : currentPRs.length / TREND_WEEKS_PER_WINDOW;
  const priorFreq =
    priorDeploys.length > 0
      ? priorDeploys.length / TREND_WEEKS_PER_WINDOW
      : priorPRs.length / TREND_WEEKS_PER_WINDOW;

  // Lead time (median hours, reuse shared helper)
  const currentLeadHours = median(
    currentPRs
      .filter((pr) => pr.merged_at !== null)
      .map((pr) => differenceInHours(parseISO(pr.merged_at as string), parseISO(pr.created_at))),
  );
  const priorLeadHours = median(
    priorPRs
      .filter((pr) => pr.merged_at !== null)
      .map((pr) => differenceInHours(parseISO(pr.merged_at as string), parseISO(pr.created_at))),
  );

  // Change failure rate
  const currentFailed = currentRuns.filter((r) => r.conclusion === "failure");
  const currentCFR = currentRuns.length > 0 ? (currentFailed.length / currentRuns.length) * 100 : 0;
  const priorFailed = priorRuns.filter((r) => r.conclusion === "failure");
  const priorCFR = priorRuns.length > 0 ? (priorFailed.length / priorRuns.length) * 100 : 0;

  const currentScore = windowScore(currentFreq, currentLeadHours, currentCFR);
  const priorScore = windowScore(priorFreq, priorLeadHours, priorCFR);

  return {
    windowDays: TREND_WINDOW_DAYS,
    current: {
      deploymentsPerWeek: +currentFreq.toFixed(2),
      leadTimeHours: +currentLeadHours.toFixed(1),
      changeFailureRate: +currentCFR.toFixed(1),
      score: currentScore,
    },
    prior: {
      deploymentsPerWeek: +priorFreq.toFixed(2),
      leadTimeHours: +priorLeadHours.toFixed(1),
      changeFailureRate: +priorCFR.toFixed(1),
      score: priorScore,
    },
    deltas: {
      deploymentsPerWeek: +(currentFreq - priorFreq).toFixed(2),
      leadTimeHours: +(currentLeadHours - priorLeadHours).toFixed(1),
      changeFailureRate: +(currentCFR - priorCFR).toFixed(1),
      score: currentScore - priorScore,
    },
  };
}

// ---------------------------------------------------------------------------
// Public: Full analysis
// ---------------------------------------------------------------------------

export async function analyze(
  repoSlug: string,
  token?: string,
  options?: { withTrend?: boolean },
): Promise<AnalysisResult> {
  const id = parseRepoSlug(repoSlug);
  const octokit = createOctokit(token);

  const [deployResult, leadTime, cfr, vulns] = await Promise.all([
    computeDeployFrequency(octokit, id),
    computeLeadTime(octokit, id),
    computeCFR(octokit, id),
    scanVulnerabilities(octokit, id),
  ]);

  const doraMetrics: DORAMetrics = {
    deploymentFrequency: deployResult.freq,
    leadTimeForChanges: leadTime,
    changeFailureRate: cfr,
  };

  const suggestions = generateSuggestions(doraMetrics, vulns);
  const overallScore = computeScore(doraMetrics, vulns);
  const trend = options?.withTrend ? await computeTrend(octokit, id) : undefined;

  return {
    repo: id,
    fetchedAt: new Date().toISOString(),
    doraMetrics,
    vulnerabilities: vulns,
    suggestions,
    overallScore,
    dailyDeployments: deployResult.daily,
    trend,
  };
}
