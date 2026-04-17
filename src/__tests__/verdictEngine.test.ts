import { describe, it, expect } from "vitest";
import { computeVerdict } from "../scoring/verdictEngine";
import type { MetricSuite } from "../domain/metrics";
import type { ForensicSignal } from "../domain/forensics";
import type { DependencyVulnerability } from "../types/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetricResult<T>(value: T | null, tier: string, confidence: string) {
  return {
    key: "test",
    value,
    tier: tier as "Elite" | "High" | "Medium" | "Low" | "Unknown",
    confidence: confidence as "high" | "medium" | "low" | "unknown",
    evidenceSources: ["test"],
    caveats: [],
    isInferred: false,
    coverage: { sampleSize: 10, windowDays: 30 },
    assumptions: [],
    howToImproveAccuracy: [],
  };
}

function makeEliteMetrics(): MetricSuite {
  return {
    deploymentFrequency: makeMetricResult(
      { deploymentsPerWeek: 10, signalType: "deployments_api" as const },
      "Elite",
      "high",
    ),
    changeLeadTime: makeMetricResult(
      {
        commitToDeployMedianHours: 4,
        prFlowMedianHours: 3,
        primarySignal: "commit_to_deploy" as const,
      },
      "Elite",
      "high",
    ),
    failedDeploymentRecoveryTime: makeMetricResult(
      { medianHours: 0.5, p75Hours: 1, sampleSize: 5 },
      "Elite",
      "high",
    ),
    changeFailRate: makeMetricResult(
      { percentage: 2, reworkCount: 1, totalDeployments: 50 },
      "Elite",
      "high",
    ),
    pipelineFailureRate: makeMetricResult(
      { percentage: 1, failedRuns: 1, totalRuns: 100 },
      "Elite",
      "high",
    ),
    deploymentReworkRate: makeMetricResult(
      { percentage: 1, reworkCount: 1, totalDeployments: 100 },
      "Elite",
      "low",
    ),
  };
}

const noForensics: ForensicSignal[] = [];
const noVulns: DependencyVulnerability[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verdictEngine", () => {
  it("returns 'exemplary' for elite metrics with no forensics", () => {
    const verdict = computeVerdict(makeEliteMetrics(), noForensics, noVulns);
    expect(verdict.category).toBe("exemplary");
    expect(verdict.headline).toContain("Exemplary");
    expect(verdict.strengths.length).toBeGreaterThan(0);
    expect(verdict.risks.length).toBe(0);
  });

  it("returns 'fast-but-fragile' for high throughput + low stability", () => {
    const metrics = makeEliteMetrics();
    metrics.changeFailRate = makeMetricResult(
      { percentage: 40, reworkCount: 20, totalDeployments: 50 },
      "Low",
      "high",
    );
    metrics.failedDeploymentRecoveryTime = makeMetricResult(
      { medianHours: 200, p75Hours: 300, sampleSize: 5 },
      "Low",
      "high",
    );
    metrics.pipelineFailureRate = makeMetricResult(
      { percentage: 40, failedRuns: 40, totalRuns: 100 },
      "Low",
      "high",
    );

    const verdict = computeVerdict(metrics, noForensics, noVulns);
    expect(verdict.category).toBe("fast-but-fragile");
    expect(verdict.headline).toContain("Fast but fragile");
  });

  it("returns 'reliable-but-slow' for high stability + low throughput", () => {
    const metrics = makeEliteMetrics();
    metrics.deploymentFrequency = makeMetricResult(
      { deploymentsPerWeek: 0.1, signalType: "deployments_api" as const },
      "Low",
      "high",
    );
    metrics.changeLeadTime = makeMetricResult(
      {
        commitToDeployMedianHours: 800,
        prFlowMedianHours: 600,
        primarySignal: "commit_to_deploy" as const,
      },
      "Low",
      "high",
    );

    const verdict = computeVerdict(metrics, noForensics, noVulns);
    expect(verdict.category).toBe("reliable-but-slow");
    expect(verdict.headline).toContain("Reliable but slow");
  });

  it("returns 'unstable' when stability is very low", () => {
    const metrics = makeEliteMetrics();
    metrics.deploymentFrequency = makeMetricResult(
      { deploymentsPerWeek: 0.5, signalType: "deployments_api" as const },
      "Low",
      "high",
    );
    metrics.changeLeadTime = makeMetricResult(
      {
        commitToDeployMedianHours: 400,
        prFlowMedianHours: 300,
        primarySignal: "commit_to_deploy" as const,
      },
      "Medium",
      "high",
    );
    metrics.changeFailRate = makeMetricResult(
      { percentage: 50, reworkCount: 25, totalDeployments: 50 },
      "Low",
      "high",
    );
    metrics.failedDeploymentRecoveryTime = makeMetricResult(
      { medianHours: 200, p75Hours: 300, sampleSize: 5 },
      "Low",
      "high",
    );
    metrics.pipelineFailureRate = makeMetricResult(
      { percentage: 50, failedRuns: 50, totalRuns: 100 },
      "Low",
      "high",
    );

    const verdict = computeVerdict(metrics, noForensics, noVulns);
    expect(verdict.category).toBe("unstable");
    expect(verdict.headline).toContain("Unstable");
  });

  it("returns 'unknown' when most metrics have Unknown tier", () => {
    const metrics: MetricSuite = {
      deploymentFrequency: makeMetricResult(null, "Unknown", "unknown"),
      changeLeadTime: makeMetricResult(null, "Unknown", "unknown"),
      failedDeploymentRecoveryTime: makeMetricResult(null, "Unknown", "unknown"),
      changeFailRate: makeMetricResult(null, "Unknown", "unknown"),
      pipelineFailureRate: makeMetricResult(
        { percentage: 5, failedRuns: 5, totalRuns: 100 },
        "Elite",
        "high",
      ),
      deploymentReworkRate: makeMetricResult(null, "Unknown", "unknown"),
    };

    const verdict = computeVerdict(metrics, noForensics, noVulns);
    expect(verdict.category).toBe("unknown");
  });

  it("escalates to 'unstable' with 2+ critical forensic signals", () => {
    const metrics = makeEliteMetrics();
    // Medium throughput and stability so it would normally be "improving"
    metrics.deploymentFrequency = makeMetricResult(
      { deploymentsPerWeek: 2, signalType: "deployments_api" as const },
      "High",
      "high",
    );
    metrics.changeFailRate = makeMetricResult(
      { percentage: 10, reworkCount: 5, totalDeployments: 50 },
      "High",
      "high",
    );

    const forensics: ForensicSignal[] = [
      {
        id: "deploy-drought",
        title: "Deploy drought",
        severity: "critical",
        evidence: "30 day gap",
        metric: 30,
        threshold: 14,
        recommendation: "Ship more often",
      },
      {
        id: "recovery-asymmetry",
        title: "Recovery asymmetry",
        severity: "critical",
        evidence: "12× slower",
        metric: 12,
        threshold: 3,
        recommendation: "Fix rollback",
      },
    ];

    const verdict = computeVerdict(metrics, forensics, noVulns);
    expect(verdict.category).toBe("unstable");
  });

  it("includes vulnerability risks in verdict", () => {
    const vulns: DependencyVulnerability[] = [
      {
        packageName: "lodash",
        currentVersion: "4.17.0",
        vulnId: "CVE-2024-001",
        severity: "critical",
        summary: "prototype pollution",
        aliases: [],
        fixedVersion: "4.17.21",
      },
    ];

    const verdict = computeVerdict(makeEliteMetrics(), noForensics, vulns);
    expect(verdict.risks.some((r) => r.includes("critical vulnerability"))).toBe(true);
  });

  it("provides a firstFix recommendation", () => {
    const verdict = computeVerdict(makeEliteMetrics(), noForensics, noVulns);
    expect(verdict.firstFix).toBeDefined();
    expect(verdict.firstFix.length).toBeGreaterThan(0);
  });

  it("provides narrative for each category", () => {
    const verdict = computeVerdict(makeEliteMetrics(), noForensics, noVulns);
    expect(verdict.narrative.length).toBeGreaterThan(50);
    expect(verdict.narrative).toContain("strong");
  });
});
