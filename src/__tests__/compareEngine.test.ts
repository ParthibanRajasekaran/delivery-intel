import { describe, it, expect } from "vitest";
import { compareRepos } from "../cli/compareEngine";
import type { AnalysisResultV2 } from "../cli/analyzerV2";
import type { ForensicSignalId, RepoVerdict, TrustVerdict } from "../domain/forensics";

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

function makeResult(
  owner: string,
  name: string,
  tier: string,
  trustScore: number | null,
  trustLevel: string | null,
  signalIds: string[] = [],
): AnalysisResultV2 {
  const metrics = {
    deploymentFrequency: makeMetricResult(
      { deploymentsPerWeek: 5, signalType: "deployments_api" as const },
      tier,
      "high",
    ),
    changeLeadTime: makeMetricResult(
      {
        commitToDeployMedianHours: 12,
        prFlowMedianHours: 8,
        primarySignal: "commit_to_deploy" as const,
      },
      tier,
      "high",
    ),
    failedDeploymentRecoveryTime: makeMetricResult(
      { medianHours: 2, p75Hours: 4, sampleSize: 5 },
      tier,
      "high",
    ),
    changeFailRate: makeMetricResult(
      { percentage: 5, reworkCount: 1, totalDeployments: 20 },
      tier,
      "high",
    ),
    pipelineFailureRate: makeMetricResult(
      { percentage: 3, failedRuns: 3, totalRuns: 100 },
      tier,
      "high",
    ),
    deploymentReworkRate: makeMetricResult(
      { percentage: 2, reworkCount: 1, totalDeployments: 50 },
      tier,
      "low",
    ),
  };

  const forensics = signalIds.map((id) => ({
    id: id as ForensicSignalId,
    title: `Signal ${id}`,
    severity: "warning" as const,
    evidence: "test",
    metric: 50,
    threshold: 30,
    recommendation: "fix it",
  }));

  const verdict: RepoVerdict | TrustVerdict =
    trustScore !== null
      ? {
          category: "improving" as const,
          headline: "test",
          narrative: "test narrative",
          strengths: [] as string[],
          risks: [] as string[],
          firstFix: "do something",
          trustLevel: trustLevel! as TrustVerdict["trustLevel"],
          trustScore,
          trustDimensions: [
            {
              name: "Maintenance freshness",
              score: trustScore,
              weight: 1.0,
              signals: [] as string[],
            },
            { name: "CI reliability", score: trustScore, weight: 0.9, signals: [] as string[] },
            {
              name: "Vulnerability exposure",
              score: trustScore,
              weight: 0.9,
              signals: [] as string[],
            },
            {
              name: "Release hygiene",
              score: trustScore - 10,
              weight: 0.8,
              signals: [] as string[],
            },
            {
              name: "Contributor concentration",
              score: trustScore,
              weight: 0.8,
              signals: [] as string[],
            },
            { name: "Change safety", score: trustScore, weight: 0.7, signals: [] as string[] },
          ],
        }
      : {
          category: "improving" as const,
          headline: "test",
          narrative: "test",
          strengths: [] as string[],
          risks: [] as string[],
          firstFix: "do something",
        };

  return {
    schemaVersion: 2,
    repo: { owner, repo: name },
    fetchedAt: new Date().toISOString(),
    repoProfile: {} as unknown as AnalysisResultV2["repoProfile"],
    metrics,
    vulnerabilities: [],
    scannedManifests: [],
    scores: {
      delivery: {
        score: 75,
        confidence: "medium" as const,
        components: [],
        caveats: [],
      },
    },
    recommendations: [],
    dailyDeployments: [0, 0, 0, 0, 0, 0, 0],
    scorecard: {} as unknown as AnalysisResultV2["scorecard"],
    fixPacks: [],
    forensics,
    verdict,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compareEngine", () => {
  it("declares winner when trust scores differ by >5", () => {
    const a = makeResult("acme", "api", "Elite", 85, "high");
    const b = makeResult("acme", "web", "Medium", 55, "moderate");

    const result = compareRepos(a, b);
    expect(result.winner).toBe("a");
    expect(result.headline).toContain("acme/api");
    expect(result.headline).toContain("30 points higher");
    expect(result.trustScoreA).toBe(85);
    expect(result.trustScoreB).toBe(55);
  });

  it("declares tie when scores are within 5 points", () => {
    const a = makeResult("acme", "api", "Elite", 80, "high");
    const b = makeResult("acme", "web", "Elite", 78, "high");

    const result = compareRepos(a, b);
    expect(result.winner).toBe("tie");
    expect(result.headline).toContain("comparable");
  });

  it("returns insufficient when trust scores are missing", () => {
    const a = makeResult("acme", "api", "Elite", null, null);
    const b = makeResult("acme", "web", "Elite", 80, "high");

    const result = compareRepos(a, b);
    expect(result.winner).toBe("insufficient");
    expect(result.headline).toContain("insufficient");
  });

  it("compares DORA metric tiers", () => {
    const a = makeResult("acme", "api", "Elite", 85, "high");
    const b = makeResult("acme", "web", "Low", 40, "low");

    const result = compareRepos(a, b);
    expect(result.metrics.length).toBe(5);
    const dfMetric = result.metrics.find((m) => m.name === "Deployment Frequency");
    expect(dfMetric).toBeDefined();
    expect(dfMetric!.winner).toBe("a");
  });

  it("identifies unique signals per repo", () => {
    const a = makeResult("acme", "api", "Elite", 85, "high", ["ci-flakiness", "deploy-drought"]);
    const b = makeResult("acme", "web", "High", 70, "moderate", [
      "deploy-drought",
      "freshness-cadence",
    ]);

    const result = compareRepos(a, b);
    expect(result.uniqueSignalsA).toEqual(["ci-flakiness"]);
    expect(result.uniqueSignalsB).toEqual(["freshness-cadence"]);
  });

  it("builds dimension comparisons from trust verdicts", () => {
    const a = makeResult("acme", "api", "Elite", 85, "high");
    const b = makeResult("acme", "web", "High", 60, "moderate");

    const result = compareRepos(a, b);
    expect(result.dimensions.length).toBe(6);
    const freshness = result.dimensions.find((d) => d.name === "Maintenance freshness");
    expect(freshness).toBeDefined();
    expect(freshness!.delta).toBe(25); // 85 - 60
    expect(freshness!.winner).toBe("a");
  });

  it("generates a narrative summarizing differences", () => {
    const a = makeResult("acme", "api", "Elite", 85, "high");
    const b = makeResult("acme", "web", "Medium", 55, "moderate");

    const result = compareRepos(a, b);
    expect(result.narrative.length).toBeGreaterThan(20);
    expect(result.narrative).toContain("acme/api");
  });
});
