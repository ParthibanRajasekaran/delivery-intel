// ============================================================================
// Suggestion Engine — Heuristic-based improvement recommendations
// ============================================================================

import type { DORAMetrics, DependencyVulnerability, Suggestion } from "@/types";

/**
 * Generate actionable suggestions based on computed metrics and
 * vulnerability scan results. Uses deterministic heuristics — no LLM needed
 * for v1, but the structured output is designed to feed into one later.
 */
export function generateSuggestions(
  dora: DORAMetrics,
  vulnerabilities: DependencyVulnerability[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // -----------------------------------------------------------------------
  // Change Failure Rate
  // -----------------------------------------------------------------------
  if (dora.changeFailureRate.percentage > 15) {
    suggestions.push({
      category: "reliability",
      severity: "high",
      title: "High Pipeline Failure Rate",
      description: `Your CI/CD pipeline has a ${dora.changeFailureRate.percentage}% failure rate, which is above the recommended 15% threshold. This suggests code is being merged without sufficient validation.`,
      actionItems: [
        "Enable Branch Protection Rules requiring passing status checks before merging.",
        "Add a required code review step (at least 1 approving review).",
        "Implement pre-merge CI checks: lint, type-check, and unit tests.",
        "Consider adding a staging environment for integration testing.",
      ],
    });
  } else if (dora.changeFailureRate.percentage > 10) {
    suggestions.push({
      category: "reliability",
      severity: "medium",
      title: "Moderate Pipeline Failure Rate",
      description: `Your failure rate is ${dora.changeFailureRate.percentage}%. While not critical, there's room for improvement.`,
      actionItems: [
        "Review recent failures for common patterns (flaky tests, environment issues).",
        "Add retry logic for known flaky integration tests.",
        "Consider caching dependencies to reduce timeout-related failures.",
      ],
    });
  }

  // -----------------------------------------------------------------------
  // Lead Time for Changes
  // -----------------------------------------------------------------------
  if (dora.leadTimeForChanges.medianHours > 168) {
    // > 1 week
    suggestions.push({
      category: "performance",
      severity: "high",
      title: "Slow Lead Time for Changes",
      description: `Median lead time is ${dora.leadTimeForChanges.medianHours} hours (${(dora.leadTimeForChanges.medianHours / 24).toFixed(1)} days). Changes take too long to reach production.`,
      actionItems: [
        "Break features into smaller, atomic pull requests (<400 lines of diff).",
        'Adopt "Ship / Show / Ask" PR methodology to reduce review bottlenecks.',
        "Set up CODEOWNERS to automatically route reviews to the right people.",
        "Consider trunk-based development with feature flags.",
      ],
    });
  } else if (dora.leadTimeForChanges.medianHours > 48) {
    suggestions.push({
      category: "performance",
      severity: "medium",
      title: "PRs Are Sitting Too Long",
      description: `Median lead time is ${dora.leadTimeForChanges.medianHours} hours. PRs may be waiting for review.`,
      actionItems: [
        "Set a team SLA for PR reviews (e.g., < 4 hours for first review).",
        "Use GitHub's auto-assign feature to distribute review load.",
        "Pair program on complex changes instead of async review.",
      ],
    });
  }

  // -----------------------------------------------------------------------
  // Deployment Frequency
  // -----------------------------------------------------------------------
  if (dora.deploymentFrequency.rating === "Low") {
    suggestions.push({
      category: "performance",
      severity: "medium",
      title: "Low Deployment Frequency",
      description: `Only ${dora.deploymentFrequency.deploymentsPerWeek} deployments per week. ${dora.deploymentFrequency.source === "merged_prs_fallback" ? "(Measured via merged PRs — no formal Deployments API usage detected.)" : ""}`,
      actionItems: [
        "Set up continuous deployment for your default branch.",
        "Adopt feature flags to decouple deployment from release.",
        "Reduce batch sizes — deploy smaller changes more frequently.",
        "Automate your release process with GitHub Actions or similar.",
      ],
    });
  }

  if (dora.deploymentFrequency.source === "merged_prs_fallback") {
    suggestions.push({
      category: "performance",
      severity: "low",
      title: "No Formal Deployment Tracking",
      description:
        "This repository doesn't use the GitHub Deployments API. Metrics are estimated from merged pull requests.",
      actionItems: [
        "Configure your CI/CD to create GitHub Deployments via the API.",
        "This enables more accurate Lead Time and Deployment Frequency calculations.",
        "See: https://docs.github.com/en/rest/deployments",
      ],
    });
  }

  // -----------------------------------------------------------------------
  // Security Vulnerabilities
  // -----------------------------------------------------------------------
  const critical = vulnerabilities.filter((v) => v.severity === "critical");
  const high = vulnerabilities.filter((v) => v.severity === "high");

  if (critical.length > 0) {
    const pkgNames = [...new Set(critical.map((v) => v.packageName))];
    suggestions.push({
      category: "security",
      severity: "high",
      title: `${critical.length} Critical Vulnerabilit${critical.length === 1 ? "y" : "ies"} Found`,
      description: `Critical vulnerabilities in: ${pkgNames.join(", ")}. These have known CVEs and should be patched immediately.`,
      actionItems: [
        ...critical
          .filter((v) => v.fixedVersion)
          .map((v) => `Update ${v.packageName} to ${v.fixedVersion} (fixes ${v.vulnId})`),
        "Run `npm audit fix` (or equivalent) to auto-patch where possible.",
        "Review the full vulnerability details and assess impact.",
      ],
    });
  }

  if (high.length > 0) {
    const pkgNames = [...new Set(high.map((v) => v.packageName))];
    suggestions.push({
      category: "security",
      severity: "medium",
      title: `${high.length} High-Severity Vulnerabilit${high.length === 1 ? "y" : "ies"} Found`,
      description: `High-severity issues in: ${pkgNames.join(", ")}.`,
      actionItems: [
        ...high
          .filter((v) => v.fixedVersion)
          .map((v) => `Update ${v.packageName} to ${v.fixedVersion} (fixes ${v.vulnId})`),
        "Schedule these patches for your next sprint.",
      ],
    });
  }

  if (vulnerabilities.length === 0) {
    suggestions.push({
      category: "security",
      severity: "low",
      title: "No Known Vulnerabilities",
      description:
        "OSV.dev scan found no known vulnerabilities in your dependency manifests. Keep dependencies up to date to maintain this.",
      actionItems: [
        "Enable Dependabot or Renovate for automated dependency updates.",
        "Run periodic security audits as part of CI.",
      ],
    });
  }

  // Sort: high → medium → low
  const severityOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return suggestions;
}

// ---------------------------------------------------------------------------
// Overall score (0–100)
// ---------------------------------------------------------------------------

const RATING_SCORES: Record<string, number> = {
  Elite: 100,
  High: 75,
  Medium: 50,
  Low: 25,
  "N/A": 50, // neutral
};

export function computeOverallScore(
  dora: DORAMetrics,
  vulnerabilities: DependencyVulnerability[],
): number {
  const doraScore =
    (RATING_SCORES[dora.deploymentFrequency.rating] +
      RATING_SCORES[dora.leadTimeForChanges.rating] +
      RATING_SCORES[dora.changeFailureRate.rating]) /
    3;

  // Penalty for vulnerabilities: -5 per critical, -2 per high, -1 per medium
  const vulnPenalty = vulnerabilities.reduce((sum, v) => {
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

  return Math.max(0, Math.min(100, Math.round(doraScore - vulnPenalty)));
}
