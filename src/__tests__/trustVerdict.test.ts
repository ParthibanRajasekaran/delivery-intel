import { describe, it, expect } from "vitest";
import { computeVerdict } from "../scoring/verdictEngine";
import type { MetricSuite } from "../domain/metrics";
import type { ForensicSignal } from "../domain/forensics";
import type { TrustVerdict } from "../domain/forensics";
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
// Trust verdict for adopt mode
// ---------------------------------------------------------------------------

describe("trust verdict (adopt mode)", () => {
  it("returns high trust for elite metrics with no signals", () => {
    const verdict = computeVerdict(makeEliteMetrics(), noForensics, noVulns, "adopt");
    const tv = verdict as TrustVerdict;
    expect(tv.trustLevel).toBe("high");
    expect(tv.trustScore).toBeGreaterThanOrEqual(70);
    expect(tv.trustDimensions.length).toBe(6);
    expect(tv.headline).toContain("Safe to adopt");
  });

  it("returns low trust when critical forensic signals exist", () => {
    // Use poor metrics to compound with bad signals
    const poorMetrics: MetricSuite = {
      deploymentFrequency: makeMetricResult(
        { deploymentsPerWeek: 0.2, signalType: "deployments_api" as const },
        "Low",
        "high",
      ),
      changeLeadTime: makeMetricResult(
        {
          commitToDeployMedianHours: 500,
          prFlowMedianHours: 400,
          primarySignal: "commit_to_deploy" as const,
        },
        "Low",
        "high",
      ),
      failedDeploymentRecoveryTime: makeMetricResult(
        { medianHours: 200, p75Hours: 300, sampleSize: 5 },
        "Low",
        "high",
      ),
      changeFailRate: makeMetricResult(
        { percentage: 40, reworkCount: 20, totalDeployments: 50 },
        "Low",
        "high",
      ),
      pipelineFailureRate: makeMetricResult(
        { percentage: 50, failedRuns: 50, totalRuns: 100 },
        "Low",
        "high",
      ),
      deploymentReworkRate: makeMetricResult(
        { percentage: 30, reworkCount: 15, totalDeployments: 50 },
        "Low",
        "low",
      ),
    };

    const forensics: ForensicSignal[] = [
      {
        id: "freshness-cadence",
        title: "Stale repo",
        severity: "critical",
        evidence: "200 days since last commit",
        metric: 200,
        threshold: 90,
        recommendation: "Check maintenance status",
      },
      {
        id: "dependency-exposure",
        title: "Critical vulns",
        severity: "critical",
        evidence: "3 critical, 5 high",
        metric: 8,
        threshold: 1,
        recommendation: "Upgrade deps",
      },
      {
        id: "maintainer-concentration",
        title: "Single maintainer",
        severity: "critical",
        evidence: "99% from one contributor",
        metric: 99,
        threshold: 70,
        recommendation: "Recruit co-maintainers",
      },
    ];
    const vulns: DependencyVulnerability[] = [
      {
        packageName: "evil-lib",
        currentVersion: "1.0.0",
        vulnId: "CVE-2024-001",
        severity: "critical",
        summary: "RCE",
        aliases: [],
        fixedVersion: "1.0.1",
      },
    ];

    const verdict = computeVerdict(poorMetrics, forensics, vulns, "adopt");
    const tv = verdict as TrustVerdict;
    expect(tv.trustLevel).toBe("low");
    expect(tv.trustScore).toBeLessThan(45);
  });

  it("returns insufficient-evidence when most metrics are unknown", () => {
    const metrics: MetricSuite = {
      deploymentFrequency: makeMetricResult(null, "Unknown", "unknown"),
      changeLeadTime: makeMetricResult(null, "Unknown", "unknown"),
      failedDeploymentRecoveryTime: makeMetricResult(null, "Unknown", "unknown"),
      changeFailRate: makeMetricResult(null, "Unknown", "unknown"),
      pipelineFailureRate: makeMetricResult(null, "Unknown", "unknown"),
      deploymentReworkRate: makeMetricResult(null, "Unknown", "unknown"),
    };

    const verdict = computeVerdict(metrics, noForensics, noVulns, "adopt");
    const tv = verdict as TrustVerdict;
    expect(tv.trustLevel).toBe("insufficient-evidence");
    expect(tv.category).toBe("unknown");
  });

  it("returns moderate trust for mixed signals", () => {
    const forensics: ForensicSignal[] = [
      {
        id: "release-hygiene",
        title: "Weak release hygiene",
        severity: "warning",
        evidence: "60% non-semver",
        metric: 20,
        threshold: 30,
        recommendation: "Adopt semver",
      },
    ];

    const verdict = computeVerdict(makeEliteMetrics(), forensics, noVulns, "adopt");
    const tv = verdict as TrustVerdict;
    expect(["high", "moderate"]).toContain(tv.trustLevel);
    expect(tv.trustDimensions).toBeDefined();
    expect(tv.trustDimensions.length).toBe(6);
  });

  it("each trust dimension has name, score, weight, and signals", () => {
    const verdict = computeVerdict(makeEliteMetrics(), noForensics, noVulns, "adopt");
    const tv = verdict as TrustVerdict;
    for (const dim of tv.trustDimensions) {
      expect(dim.name).toBeTruthy();
      expect(typeof dim.score).toBe("number");
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(100);
      expect(typeof dim.weight).toBe("number");
      expect(Array.isArray(dim.signals)).toBe(true);
    }
  });

  it("non-adopt modes do not produce trust verdict", () => {
    const verdict = computeVerdict(makeEliteMetrics(), noForensics, noVulns, "pr");
    expect("trustLevel" in verdict).toBe(false);
    expect(verdict.category).toBe("exemplary");
  });

  it("null mode falls back to standard verdict", () => {
    const verdict = computeVerdict(makeEliteMetrics(), noForensics, noVulns, null);
    expect("trustLevel" in verdict).toBe(false);
  });
});
