// ============================================================================
// Domain: Multi-Dimensional Scorecard
// ============================================================================
// Replaces the single-number health score with a structured policy-aware
// scorecard. Each dimension has an explicit grade, rationale, and evidence
// quality indicator. This is the artefact that all surfaces (CLI, PR comment,
// badge) should render.
//
// Dimensions:
//   delivery          — confidence-weighted composite of DORA metrics
//   evidenceQuality   — how trustworthy is the underlying data (A–D)
//   securityHygiene   — vulnerability posture (pass / warn / fail)
//   flowHealth        — lead time + deployment frequency signal
//   stabilityHealth   — change fail rate + recovery time signal
//   operationalMaturity — deployment tracking, CI, branch protection signals
// ============================================================================

import type { MetricSuite, MetricConfidence } from "./metrics.js";
import type { ScoreBreakdown } from "./scoring.js";
import type { DependencyVulnerability } from "../cli/analyzer.js";
import { toLetterGrade } from "./policy.js";

// ---------------------------------------------------------------------------
// Evidence quality grade (A → D)
// ---------------------------------------------------------------------------

export type EvidenceGrade = "A" | "B" | "C" | "D";

/**
 * Grades the overall trustworthiness of the metric data.
 *
 * A — all primary signals available, high confidence throughout
 * B — most signals high confidence; at most one inferred metric
 * C — mixed; production deployment data absent for 1+ DORA metric
 * D — majority of metrics are inferred or unknown
 */
export function computeEvidenceGrade(metrics: MetricSuite): EvidenceGrade {
  const all = [
    metrics.deploymentFrequency,
    metrics.changeLeadTime,
    metrics.changeFailRate,
    metrics.failedDeploymentRecoveryTime,
    metrics.pipelineFailureRate,
  ];

  const inferred = all.filter((m) => m.isInferred).length;
  const unknown = all.filter((m) => m.confidence === "unknown").length;
  const high = all.filter((m) => m.confidence === "high").length;

  if (unknown >= 2 || inferred >= 4) {
    return "D";
  }
  if (unknown >= 1 || inferred >= 3) {
    return "C";
  }
  if (inferred >= 1 || high < 3) {
    return "B";
  }
  return "A";
}

// ---------------------------------------------------------------------------
// Gate dimensions
// ---------------------------------------------------------------------------

export type GateStatus = "pass" | "warn" | "fail";

function securityHygiene(vulns: DependencyVulnerability[]): GateStatus {
  const critical = vulns.filter((v) => v.severity === "critical").length;
  const high = vulns.filter((v) => v.severity === "high").length;
  if (critical > 0) {
    return "fail";
  }
  if (high > 0) {
    return "warn";
  }
  return "pass";
}

function flowHealth(metrics: MetricSuite): GateStatus {
  const df = metrics.deploymentFrequency;
  const lt = metrics.changeLeadTime;
  if (df.tier === "Low" || lt.tier === "Low") {
    return "fail";
  }
  if (df.tier === "Medium" || lt.tier === "Medium" || df.confidence === "low") {
    return "warn";
  }
  return "pass";
}

function stabilityHealth(metrics: MetricSuite): GateStatus {
  const cfr = metrics.changeFailRate;
  const fdrt = metrics.failedDeploymentRecoveryTime;
  if (cfr.tier === "Low" || fdrt.tier === "Low") {
    return "fail";
  }
  if (
    cfr.tier === "Medium" ||
    fdrt.tier === "Medium" ||
    cfr.confidence === "low" ||
    cfr.confidence === "unknown"
  ) {
    return "warn";
  }
  return "pass";
}

function operationalMaturity(metrics: MetricSuite): GateStatus {
  const df = metrics.deploymentFrequency;
  const cfr = metrics.changeFailRate;
  const pfr = metrics.pipelineFailureRate;

  // Inferred signals mean tracking is missing
  const inferredCount = [df, cfr].filter((m) => m.isInferred).length;
  if (inferredCount >= 2) {
    return "fail";
  }
  if (inferredCount >= 1 || pfr.confidence === "unknown") {
    return "warn";
  }
  return "pass";
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

export interface Scorecard {
  /** Delivery score letter grade. */
  grade: ReturnType<typeof toLetterGrade>;
  /** Numeric delivery score (0–100). */
  deliveryScore: number;
  /** Aggregate confidence of all inputs. */
  deliveryConfidence: MetricConfidence;
  /** How trustworthy is the evidence powering the score (A = gold, D = mostly inferred). */
  evidenceQuality: EvidenceGrade;
  /** Security posture. */
  securityHygiene: GateStatus;
  /** Deployment frequency + lead time combined signal. */
  flowHealth: GateStatus;
  /** Change fail rate + recovery time combined signal. */
  stabilityHealth: GateStatus;
  /** Whether deployment events, CI, and tracking are properly instrumented. */
  operationalMaturity: GateStatus;
  /** How many DORA metrics are inferred (not directly measured). */
  inferredMetricCount: number;
  /** Total DORA metrics evaluated. */
  totalMetricCount: number;
}

export function buildScorecard(
  metrics: MetricSuite,
  vulns: DependencyVulnerability[],
  delivery: ScoreBreakdown,
): Scorecard {
  const all = [
    metrics.deploymentFrequency,
    metrics.changeLeadTime,
    metrics.changeFailRate,
    metrics.failedDeploymentRecoveryTime,
    metrics.pipelineFailureRate,
  ];

  return {
    grade: toLetterGrade(delivery.score),
    deliveryScore: delivery.score,
    deliveryConfidence: delivery.confidence,
    evidenceQuality: computeEvidenceGrade(metrics),
    securityHygiene: securityHygiene(vulns),
    flowHealth: flowHealth(metrics),
    stabilityHealth: stabilityHealth(metrics),
    operationalMaturity: operationalMaturity(metrics),
    inferredMetricCount: all.filter((m) => m.isInferred).length,
    totalMetricCount: all.length,
  };
}
