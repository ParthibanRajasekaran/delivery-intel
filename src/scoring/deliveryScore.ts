// ============================================================================
// Scoring: Delivery Score
// ============================================================================
// Multi-dimensional, confidence-weighted score replacing the simple average.
// Components: deployment frequency, lead time, recovery time, change fail
// rate, pipeline failure rate. Each component's effective weight is reduced
// proportionally to its confidence level so low-evidence signals don't
// dominate the total.
// ============================================================================

import type { MetricSuite } from "../domain/metrics.js";
import type { ScoreBreakdown, ScoreComponent } from "../domain/scoring.js";
import { tierToScore, confidenceMultiplier, aggregateConfidence } from "../domain/scoring.js";
import type { DependencyVulnerability } from "../cli/analyzer.js";

function buildComponent(
  name: string,
  tier: string,
  confidence: string,
  weight: number,
  explanation: string,
): ScoreComponent {
  // Avoid importing full enum types — just use tierToScore/confidenceMultiplier
  const rawScore = tierToScore(tier as Parameters<typeof tierToScore>[0]);
  const cm = confidenceMultiplier(confidence as Parameters<typeof confidenceMultiplier>[0]);
  return {
    name,
    rawScore,
    weight,
    effectiveWeight: weight * cm,
    explanation,
  };
}

function vulnerabilityPenalty(vulns: DependencyVulnerability[]): number {
  return vulns.reduce((sum, v) => {
    if (v.severity === "critical") {
      return sum + 5;
    }
    if (v.severity === "high") {
      return sum + 2;
    }
    if (v.severity === "medium") {
      return sum + 0.5;
    }
    return sum;
  }, 0);
}

export function computeDeliveryScore(
  metrics: MetricSuite,
  vulns: DependencyVulnerability[],
): ScoreBreakdown {
  const components: ScoreComponent[] = [
    buildComponent(
      "Deployment Frequency",
      metrics.deploymentFrequency.tier,
      metrics.deploymentFrequency.confidence,
      0.25,
      `${metrics.deploymentFrequency.value?.deploymentsPerWeek ?? 0} deploys/week — ${metrics.deploymentFrequency.tier} tier`,
    ),
    buildComponent(
      "Change Lead Time",
      metrics.changeLeadTime.tier,
      metrics.changeLeadTime.confidence,
      0.25,
      (() => {
        const v = metrics.changeLeadTime.value;
        if (!v) {
          return "Insufficient data";
        }
        const h =
          v.primarySignal === "commit_to_deploy"
            ? v.commitToDeployMedianHours
            : v.prFlowMedianHours;
        return `${h ?? "N/A"}h median — ${metrics.changeLeadTime.tier} tier`;
      })(),
    ),
    buildComponent(
      "Failed Deployment Recovery Time",
      metrics.failedDeploymentRecoveryTime.tier,
      metrics.failedDeploymentRecoveryTime.confidence,
      0.2,
      metrics.failedDeploymentRecoveryTime.value
        ? `${metrics.failedDeploymentRecoveryTime.value.medianHours}h median recovery`
        : "Insufficient data",
    ),
    buildComponent(
      "Change Fail Rate",
      metrics.changeFailRate.tier,
      metrics.changeFailRate.confidence,
      0.15,
      metrics.changeFailRate.value
        ? `${metrics.changeFailRate.value.percentage}% of deployments failed`
        : "Insufficient data",
    ),
    buildComponent(
      "Pipeline Failure Rate",
      metrics.pipelineFailureRate.tier,
      metrics.pipelineFailureRate.confidence,
      0.15,
      metrics.pipelineFailureRate.value
        ? `${metrics.pipelineFailureRate.value.percentage}% pipeline failure rate`
        : "Insufficient data",
    ),
  ];

  const totalEffectiveWeight = components.reduce((s, c) => s + c.effectiveWeight, 0);
  const weightedScore =
    totalEffectiveWeight > 0
      ? components.reduce((s, c) => s + c.rawScore * c.effectiveWeight, 0) / totalEffectiveWeight
      : 50;

  const penalty = vulnerabilityPenalty(vulns);
  const finalScore = Math.max(0, Math.min(100, Math.round(weightedScore - penalty)));

  const caveats: string[] = [];
  if (vulns.some((v) => v.severity === "critical" || v.severity === "high")) {
    caveats.push(
      `Score penalised by ${penalty.toFixed(1)} points for ${vulns.filter((v) => v.severity === "critical").length} critical and ${vulns.filter((v) => v.severity === "high").length} high-severity vulnerabilities.`,
    );
  }

  const allConfidences = [
    metrics.deploymentFrequency.confidence,
    metrics.changeLeadTime.confidence,
    metrics.failedDeploymentRecoveryTime.confidence,
    metrics.changeFailRate.confidence,
    metrics.pipelineFailureRate.confidence,
  ];

  return {
    score: finalScore,
    confidence: aggregateConfidence(allConfidences as Parameters<typeof aggregateConfidence>[0]),
    components,
    caveats,
  };
}
