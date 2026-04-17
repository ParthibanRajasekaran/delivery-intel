// ============================================================================
// Domain: Policy Engine
// ============================================================================
// Policies translate metric results into explicit verdicts.
// Every violation must include: rule name, breached threshold, evidence
// window, source, and a recommended fix. No vague output.
//
// Severity levels:
//   blocking  — CI gate fails; must be explicitly opted in via config
//   warning   — posted as PR comment / CLI warning; never blocks by default
//   info      — informational only; shown in verbose mode
// ============================================================================

import type { MetricSuite } from "./metrics.js";
import type { DependencyVulnerability } from "../cli/analyzer.js";
import type { ScoreBreakdown } from "./scoring.js";

export type PolicySeverity = "blocking" | "warning" | "info";

export interface PolicyViolation {
  /** Stable machine-readable ID for the rule. */
  ruleId: string;
  /** Human-readable rule name. */
  ruleName: string;
  severity: PolicySeverity;
  /** Concise description of what was breached. */
  message: string;
  /** The actual value that triggered the violation. */
  actualValue: string;
  /** The threshold that was breached. */
  threshold: string;
  /** Evidence that backs the violation. */
  evidence: string;
  /** Single most important fix action. */
  fix: string;
}

export interface PolicyThresholds {
  /** Min delivery score before a blocking violation fires. Default: none (warnings only). */
  blockBelowScore?: number;
  /** Pipeline failure rate (%) above which to warn. Default: 20 */
  warnPipelineFailureRate: number;
  /** Pipeline failure rate (%) above which to block. Default: none */
  blockPipelineFailureRate?: number;
  /** Change fail rate (%) above which to warn. Default: 15 */
  warnChangeFailRate: number;
  /** Recovery time (hours) above which to warn. Default: 24 */
  warnRecoveryHours: number;
  /** Lead time (hours) above which to warn. Default: 168 (1 week) */
  warnLeadTimeHours: number;
  /** Whether any critical vulnerability is a blocking violation. Default: false */
  blockOnCriticalVulns: boolean;
  /** Whether any high vulnerability is a warning. Default: true */
  warnOnHighVulns: boolean;
}

export const DEFAULT_THRESHOLDS: PolicyThresholds = {
  warnPipelineFailureRate: 20,
  warnChangeFailRate: 15,
  warnRecoveryHours: 24,
  warnLeadTimeHours: 168,
  blockOnCriticalVulns: false,
  warnOnHighVulns: true,
};

// ---------------------------------------------------------------------------
// Letter grade
// ---------------------------------------------------------------------------

export type LetterGrade = "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D" | "F";

export function toLetterGrade(score: number): LetterGrade {
  if (score >= 97) {
    return "A+";
  }
  if (score >= 93) {
    return "A";
  }
  if (score >= 90) {
    return "A-";
  }
  if (score >= 87) {
    return "B+";
  }
  if (score >= 83) {
    return "B";
  }
  if (score >= 80) {
    return "B-";
  }
  if (score >= 77) {
    return "C+";
  }
  if (score >= 73) {
    return "C";
  }
  if (score >= 70) {
    return "C-";
  }
  if (score >= 60) {
    return "D";
  }
  return "F";
}

export function gradeColor(grade: LetterGrade): "green" | "yellow" | "red" {
  if (grade.startsWith("A")) {
    return "green";
  }
  if (grade.startsWith("B") || grade.startsWith("C")) {
    return "yellow";
  }
  return "red";
}

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

export interface PolicyResult {
  violations: PolicyViolation[];
  /** True if any blocking violation is present and blockingEnabled is true. */
  shouldBlock: boolean;
  /** True if any warning or blocking violation is present. */
  hasWarnings: boolean;
}

export function evaluatePolicies(
  metrics: MetricSuite,
  vulns: DependencyVulnerability[],
  delivery: ScoreBreakdown,
  thresholds: PolicyThresholds = DEFAULT_THRESHOLDS,
  blockingEnabled = false,
): PolicyResult {
  const violations: PolicyViolation[] = [];

  // --- Score floor ---
  if (thresholds.blockBelowScore !== undefined && delivery.score < thresholds.blockBelowScore) {
    violations.push({
      ruleId: "score-floor",
      ruleName: "Delivery Score Floor",
      severity: "blocking",
      message: `Delivery score (${delivery.score}) is below the team floor (${thresholds.blockBelowScore}).`,
      actualValue: `${delivery.score}`,
      threshold: `≥ ${thresholds.blockBelowScore}`,
      evidence: `Composite score based on ${metrics.deploymentFrequency.evidenceSources.join(", ")}`,
      fix: "Review the top component scores — usually lead time or pipeline failures are the main drag.",
    });
  }

  // --- Pipeline failure rate ---
  const pfr = metrics.pipelineFailureRate.value;
  if (pfr) {
    if (
      thresholds.blockPipelineFailureRate !== undefined &&
      pfr.percentage > thresholds.blockPipelineFailureRate
    ) {
      violations.push({
        ruleId: "pipeline-failure-rate-block",
        ruleName: "Pipeline Failure Rate (Blocking)",
        severity: "blocking",
        message: `${pfr.percentage}% of workflow runs failed — above the blocking threshold of ${thresholds.blockPipelineFailureRate}%.`,
        actualValue: `${pfr.percentage}% (${pfr.failedRuns}/${pfr.totalRuns} runs)`,
        threshold: `< ${thresholds.blockPipelineFailureRate}%`,
        evidence: `${pfr.totalRuns} completed workflow runs in the last 30 days`,
        fix: "Investigate the most frequently failing workflow. Quarantine flaky tests first.",
      });
    } else if (pfr.percentage > thresholds.warnPipelineFailureRate) {
      violations.push({
        ruleId: "pipeline-failure-rate-warn",
        ruleName: "Pipeline Failure Rate",
        severity: "warning",
        message: `${pfr.percentage}% of workflow runs failed (threshold: ${thresholds.warnPipelineFailureRate}%).`,
        actualValue: `${pfr.percentage}% (${pfr.failedRuns}/${pfr.totalRuns} runs)`,
        threshold: `< ${thresholds.warnPipelineFailureRate}%`,
        evidence: `${pfr.totalRuns} completed workflow runs in the last 30 days`,
        fix: "Add retry logic for network-dependent steps and quarantine flaky tests.",
      });
    }
  }

  // --- Change fail rate ---
  const cfr = metrics.changeFailRate.value;
  if (cfr && cfr.percentage > thresholds.warnChangeFailRate) {
    violations.push({
      ruleId: "change-fail-rate",
      ruleName: "Change Fail Rate",
      severity: "warning",
      message: `${cfr.percentage}% of deployments failed or required rollback (threshold: ${thresholds.warnChangeFailRate}%).`,
      actualValue: `${cfr.percentage}% (${cfr.reworkCount}/${cfr.totalDeployments} deployments)`,
      threshold: `< ${thresholds.warnChangeFailRate}%`,
      evidence: `${cfr.totalDeployments} deployments, signal: ${metrics.changeFailRate.evidenceSources.join(", ")}`,
      fix: "Add integration tests against a staging environment before promoting to production.",
    });
  }

  // --- Recovery time ---
  const fdrt = metrics.failedDeploymentRecoveryTime.value;
  if (fdrt && fdrt.medianHours > thresholds.warnRecoveryHours) {
    violations.push({
      ruleId: "recovery-time",
      ruleName: "Failed Deployment Recovery Time",
      severity: "warning",
      message: `Median recovery time is ${fdrt.medianHours}h (threshold: ${thresholds.warnRecoveryHours}h).`,
      actualValue: `${fdrt.medianHours}h median`,
      threshold: `< ${thresholds.warnRecoveryHours}h`,
      evidence: `Based on ${metrics.failedDeploymentRecoveryTime.evidenceSources.join(", ")}`,
      fix: "Implement one-click rollback and automated health-check-triggered rollback triggers.",
    });
  }

  // --- Lead time ---
  const lt = metrics.changeLeadTime.value;
  const ltHours =
    lt?.primarySignal === "commit_to_deploy" ? lt.commitToDeployMedianHours : lt?.prFlowMedianHours;
  if (ltHours !== null && ltHours !== undefined && ltHours > thresholds.warnLeadTimeHours) {
    violations.push({
      ruleId: "lead-time",
      ruleName: "Change Lead Time",
      severity: "info",
      message: `Median lead time is ${ltHours}h (${(ltHours / 24).toFixed(1)} days). Elite benchmark: < 24h.`,
      actualValue: `${ltHours}h`,
      threshold: `< ${thresholds.warnLeadTimeHours}h`,
      evidence: `Signal: ${metrics.changeLeadTime.evidenceSources.join(", ")}, confidence: ${metrics.changeLeadTime.confidence}`,
      fix: "Break features into smaller PRs and set a team SLA for first review within 4h.",
    });
  }

  // --- Critical vulnerabilities ---
  const critical = vulns.filter((v) => v.severity === "critical");
  if (critical.length > 0) {
    violations.push({
      ruleId: "critical-vulns",
      ruleName: "Critical Vulnerabilities",
      severity: thresholds.blockOnCriticalVulns ? "blocking" : "warning",
      message: `${critical.length} critical vulnerabilit${critical.length === 1 ? "y" : "ies"} found in dependencies.`,
      actualValue: `${critical.length} critical`,
      threshold: "0 critical",
      evidence: `Affected: ${[...new Set(critical.map((v) => v.packageName))].join(", ")}`,
      fix: critical
        .filter((v) => v.fixedVersion)
        .slice(0, 3)
        .map((v) => `Update ${v.packageName} → ${v.fixedVersion}`)
        .join("; "),
    });
  }

  // --- High vulnerabilities ---
  const high = vulns.filter((v) => v.severity === "high");
  if (thresholds.warnOnHighVulns && high.length > 0) {
    violations.push({
      ruleId: "high-vulns",
      ruleName: "High-Severity Vulnerabilities",
      severity: "info",
      message: `${high.length} high-severity vulnerabilit${high.length === 1 ? "y" : "ies"} found.`,
      actualValue: `${high.length} high`,
      threshold: "0 high",
      evidence: `Affected: ${[...new Set(high.map((v) => v.packageName))].join(", ")}`,
      fix: high
        .filter((v) => v.fixedVersion)
        .slice(0, 3)
        .map((v) => `Update ${v.packageName} → ${v.fixedVersion}`)
        .join("; "),
    });
  }

  const hasWarnings = violations.some((v) => v.severity === "warning" || v.severity === "blocking");
  const shouldBlock = blockingEnabled && violations.some((v) => v.severity === "blocking");

  return { violations, shouldBlock, hasWarnings };
}
