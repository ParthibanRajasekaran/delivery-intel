// ============================================================================
// Delivery Intel — Standalone CLI Analyzer
// ============================================================================
// This module re-exports the core analysis logic without Next.js dependencies,
// so it can be used from the CLI or programmatically.
// ============================================================================

import type { Octokit } from "@octokit/rest";
import { differenceInHours, differenceInCalendarWeeks, parseISO } from "date-fns";
import { type ParsedDependency, parsePackageJson, parseRequirementsTxt } from "../shared/parsers";
import { queryOSV, classifySeverity, extractFixedVersion } from "../shared/osv";
import {
  type RepoIdentifier,
  createOctokit,
  parseRepoSlug,
  fetchDeployments,
  fetchMergedPRs,
  fetchWorkflowRuns,
  fetchFileContent,
} from "../shared/github";

// ---------------------------------------------------------------------------
// Types (self-contained, no @/ alias)
// ---------------------------------------------------------------------------

export type { RepoIdentifier };
export { parseRepoSlug };

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

export interface AnalysisResult {
  repo: RepoIdentifier;
  fetchedAt: string;
  doraMetrics: DORAMetrics;
  vulnerabilities: DependencyVulnerability[];
  suggestions: Suggestion[];
  overallScore: number;
  /** Deployment counts for the last 7 days (index 0 = 6 days ago, index 6 = today). */
  dailyDeployments: number[];
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
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
// Vulnerability scanning via OSV.dev (shared parsers + helpers)
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
  if (allDeps.length === 0) {
    return [];
  }

  const vulnerabilities: DependencyVulnerability[] = [];
  const BATCH = 10;

  for (let i = 0; i < allDeps.length; i += BATCH) {
    const batch = allDeps.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((d) => queryOSV(d.ecosystem, d.name, d.version)));
    for (let j = 0; j < batch.length; j++) {
      const dep = batch[j];
      for (const vuln of results[j]) {
        vulnerabilities.push({
          packageName: dep.name,
          currentVersion: dep.version,
          vulnId: vuln.id,
          summary: vuln.summary || "No description.",
          severity: classifySeverity(vuln.severity),
          aliases: vuln.aliases || [],
          fixedVersion: extractFixedVersion(vuln.affected, dep),
        });
      }
    }
  }
  return vulnerabilities;
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
// Public: Full analysis
// ---------------------------------------------------------------------------

export async function analyze(repoSlug: string, token?: string): Promise<AnalysisResult> {
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

  return {
    repo: id,
    fetchedAt: new Date().toISOString(),
    doraMetrics,
    vulnerabilities: vulns,
    suggestions,
    overallScore,
    dailyDeployments: deployResult.daily,
  };
}
