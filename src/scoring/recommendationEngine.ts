// ============================================================================
// Scoring: Recommendation Engine
// ============================================================================
// Consumes MetricSuite + vulnerabilities + scores and produces ranked,
// actionable recommendations. Unlike the old suggestion engine which derived
// recommendations from raw DORAMetrics, this operates on clean typed results.
// ============================================================================

import type { MetricSuite } from "../domain/metrics.js";
import type { ScoreBreakdown } from "../domain/scoring.js";
import type { DependencyVulnerability, Suggestion } from "../cli/analyzer.js";

export function generateRecommendationsV2(
  metrics: MetricSuite,
  vulns: DependencyVulnerability[],
  _delivery: ScoreBreakdown,
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // --- Pipeline failure rate ---
  const pfr = metrics.pipelineFailureRate.value;
  if (pfr && pfr.percentage > 20) {
    suggestions.push({
      category: "reliability",
      severity: "high",
      title: "High Pipeline Failure Rate",
      description: `${pfr.percentage}% of completed workflow runs failed (${pfr.failedRuns}/${pfr.totalRuns}). Above the 20% reliability threshold.`,
      actionItems: [
        "Enable Branch Protection Rules requiring passing status checks before merge.",
        "Add required code reviews to catch errors before CI.",
        "Review recent failures for common patterns (flaky tests, infra issues).",
      ],
    });
  } else if (pfr && pfr.percentage > 10) {
    suggestions.push({
      category: "reliability",
      severity: "medium",
      title: "Moderate Pipeline Failure Rate",
      description: `${pfr.percentage}% pipeline failure rate. Review for flaky tests or environment issues.`,
      actionItems: [
        "Add retry logic for network-dependent test steps.",
        "Isolate and quarantine flaky tests.",
      ],
    });
  }

  // --- Change fail rate ---
  const cfr = metrics.changeFailRate.value;
  if (cfr && cfr.percentage > 15) {
    suggestions.push({
      category: "reliability",
      severity: "high",
      title: "High Change Fail Rate",
      description: `${cfr.percentage}% of deployments required recovery (${cfr.reworkCount}/${cfr.totalDeployments}).`,
      actionItems: [
        "Invest in pre-production environments that mirror production more closely.",
        "Add integration tests that run against staging before promoting to production.",
        "Implement feature flags to decouple deployment from release.",
      ],
    });
  }

  // --- Lead time ---
  const lt = metrics.changeLeadTime.value;
  const ltHours =
    lt?.primarySignal === "commit_to_deploy" ? lt.commitToDeployMedianHours : lt?.prFlowMedianHours;
  if (ltHours !== null && ltHours !== undefined && ltHours > 168) {
    suggestions.push({
      category: "performance",
      severity: "high",
      title: "Slow Lead Time for Changes",
      description: `Median ${ltHours}h (${(ltHours / 24).toFixed(1)} days). Elite benchmark is < 24h.`,
      actionItems: [
        "Break features into smaller PRs (< 400 lines is a useful target).",
        "Set up CODEOWNERS for automatic review routing.",
        "Consider trunk-based development with feature flags.",
      ],
    });
  } else if (ltHours !== null && ltHours !== undefined && ltHours > 48) {
    suggestions.push({
      category: "performance",
      severity: "medium",
      title: "PRs Taking Too Long to Ship",
      description: `Median ${ltHours}h. Set a team SLA for first review response.`,
      actionItems: [
        "Set a team SLA: first review within 4 hours of PR opening.",
        "Use auto-assign to distribute review load evenly.",
      ],
    });
  }

  // --- Deployment frequency ---
  const df = metrics.deploymentFrequency.value;
  if (
    df &&
    (metrics.deploymentFrequency.tier === "Low" || metrics.deploymentFrequency.tier === "Unknown")
  ) {
    suggestions.push({
      category: "performance",
      severity: "medium",
      title: "Low Deployment Frequency",
      description: `${df.deploymentsPerWeek.toFixed(1)} deploys/week. Elite teams deploy multiple times per day.`,
      actionItems: [
        "Implement continuous deployment from your default branch.",
        "Use feature flags to safely ship incomplete features.",
        "Reduce batch size — smaller changes are safer and easier to deploy.",
      ],
    });
  }

  // --- Recovery time ---
  const fdrt = metrics.failedDeploymentRecoveryTime.value;
  if (fdrt && fdrt.medianHours > 24) {
    suggestions.push({
      category: "reliability",
      severity: "high",
      title: "Slow Failed Deployment Recovery",
      description: `Median ${fdrt.medianHours}h to recover from a failed deployment. DORA Elite is < 1h.`,
      actionItems: [
        "Implement one-click rollback to the previous successful deployment.",
        "Add automated rollback triggers on key health-check failures.",
        "Practice recovery drills to build muscle memory.",
      ],
    });
  }

  // --- Vulnerability recommendations ---
  const critical = vulns.filter((v) => v.severity === "critical");
  const high = vulns.filter((v) => v.severity === "high");

  if (critical.length > 0) {
    suggestions.push({
      category: "security",
      severity: "high",
      title: `${critical.length} Critical Vulnerability${critical.length === 1 ? "" : "ies"}`,
      description: `In: ${[...new Set(critical.map((v) => v.packageName))].join(", ")}`,
      actionItems: critical
        .filter((v) => v.fixedVersion)
        .slice(0, 5)
        .map((v) => `Update ${v.packageName} → ${v.fixedVersion} (${v.vulnId})`),
    });
  }

  if (high.length > 0) {
    suggestions.push({
      category: "security",
      severity: "medium",
      title: `${high.length} High-Severity Vulnerability${high.length === 1 ? "" : "ies"}`,
      description: `In: ${[...new Set(high.map((v) => v.packageName))].join(", ")}`,
      actionItems: high
        .filter((v) => v.fixedVersion)
        .slice(0, 5)
        .map((v) => `Update ${v.packageName} → ${v.fixedVersion} (${v.vulnId})`),
    });
  }

  if (vulns.length === 0) {
    suggestions.push({
      category: "security",
      severity: "low",
      title: "No Known Vulnerabilities",
      description: "OSV.dev found no known issues in scanned manifests.",
      actionItems: [
        "Enable Dependabot or Renovate for automated dependency updates.",
        "Schedule periodic scans as dependency vulnerability databases update daily.",
      ],
    });
  }

  // Sort: high → medium → low
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => order[a.severity] - order[b.severity]);
  return suggestions;
}
