import { describe, it, expect } from "vitest";
import { generateFixPacks } from "../scoring/fixPackEngine";
import type { MetricSuite } from "../domain/metrics";
import type { DependencyVulnerability } from "../cli/analyzer";

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

function makeInferredMetrics(): MetricSuite {
  return {
    deploymentFrequency: {
      ...makeMetricResult(
        { deploymentsPerWeek: 3, signalType: "merged_prs" as const },
        "High",
        "low",
      ),
      isInferred: true,
    },
    changeLeadTime: makeMetricResult(
      {
        commitToDeployMedianHours: 200,
        prFlowMedianHours: 180,
        primarySignal: "commit_to_deploy" as const,
      },
      "Low",
      "medium",
    ),
    failedDeploymentRecoveryTime: makeMetricResult(
      { medianHours: 48, p75Hours: 72, sampleSize: 3 },
      "Medium",
      "medium",
    ),
    changeFailRate: makeMetricResult(
      { percentage: 25, reworkCount: 5, totalDeployments: 20 },
      "Low",
      "medium",
    ),
    pipelineFailureRate: makeMetricResult(
      { percentage: 30, failedRuns: 30, totalRuns: 100 },
      "Low",
      "high",
    ),
    deploymentReworkRate: makeMetricResult(
      { percentage: 10, reworkCount: 5, totalDeployments: 50 },
      "Low",
      "low",
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fixPackEngine trustGain", () => {
  it("all fix packs have trustGain and rationale fields", () => {
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

    const packs = generateFixPacks(makeInferredMetrics(), vulns);
    expect(packs.length).toBeGreaterThan(0);

    for (const pack of packs) {
      expect(typeof pack.trustGain).toBe("number");
      expect(pack.trustGain).toBeGreaterThan(0);
      expect(typeof pack.rationale).toBe("string");
      expect(pack.rationale.length).toBeGreaterThan(10);
    }
  });

  it("security fix pack has highest trust gain", () => {
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

    const packs = generateFixPacks(makeInferredMetrics(), vulns);
    const securityPack = packs.find((p) => p.id === "missing-dependabot");
    expect(securityPack).toBeDefined();
    expect(securityPack!.trustGain).toBeGreaterThanOrEqual(10);
  });

  it("deployment tracking fix has meaningful trust gain", () => {
    const packs = generateFixPacks(makeInferredMetrics(), []);
    const deployPack = packs.find((p) => p.id === "missing-deployment-tracking");
    expect(deployPack).toBeDefined();
    expect(deployPack!.trustGain).toBeGreaterThanOrEqual(5);
  });
});
