import { describe, it, expect } from "vitest";
import {
  normalizeDelta,
  classifyRiskLevel,
  computeRiskScore,
  type RiskInput,
} from "../cli/riskEngine";

// ---------------------------------------------------------------------------
// Helper: build a minimal DORAMetrics fixture
// ---------------------------------------------------------------------------
function makeDoraMetrics(medianHours: number, failurePct: number): RiskInput["doraMetrics"] {
  return {
    deploymentFrequency: {
      deploymentsPerWeek: 10,
      rating: "Elite",
      source: "merged_prs_fallback" as const,
    },
    leadTimeForChanges: { medianHours, rating: "Elite" },
    changeFailureRate: {
      percentage: failurePct,
      failedRuns: Math.round(failurePct),
      totalRuns: 100,
      rating: "Elite",
    },
  };
}

// ---------------------------------------------------------------------------
// normalizeDelta
// ---------------------------------------------------------------------------
describe("normalizeDelta", () => {
  it("returns 0 when at or below elite benchmark", () => {
    expect(normalizeDelta(10, 24, 720)).toBe(0);
    expect(normalizeDelta(24, 24, 720)).toBe(0);
  });

  it("returns 1 when at or above max cap", () => {
    expect(normalizeDelta(720, 24, 720)).toBe(1);
    expect(normalizeDelta(1000, 24, 720)).toBe(1);
  });

  it("returns a proportional value between benchmarks", () => {
    // halfway between 24 and 720 → ~0.5
    const mid = (24 + 720) / 2;
    const result = normalizeDelta(mid, 24, 720);
    expect(result).toBeCloseTo(0.5, 1);
  });

  it("clamps negative deltas to 0", () => {
    expect(normalizeDelta(-10, 24, 720)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// classifyRiskLevel
// ---------------------------------------------------------------------------
describe("classifyRiskLevel", () => {
  it("classifies scores below 25 as low", () => {
    expect(classifyRiskLevel(0)).toBe("low");
    expect(classifyRiskLevel(24)).toBe("low");
  });

  it("classifies 25-49 as moderate", () => {
    expect(classifyRiskLevel(25)).toBe("moderate");
    expect(classifyRiskLevel(49)).toBe("moderate");
  });

  it("classifies 50-74 as high", () => {
    expect(classifyRiskLevel(50)).toBe("high");
    expect(classifyRiskLevel(74)).toBe("high");
  });

  it("classifies 75+ as critical", () => {
    expect(classifyRiskLevel(75)).toBe("critical");
    expect(classifyRiskLevel(100)).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// computeRiskScore
// ---------------------------------------------------------------------------
describe("computeRiskScore", () => {
  it("returns low risk for elite-level metrics", () => {
    const input: RiskInput = { doraMetrics: makeDoraMetrics(12, 3) };
    const result = computeRiskScore(input);
    expect(result.score).toBe(0);
    expect(result.level).toBe("low");
    expect(result.cycleTimeDelta).toBe(0);
    expect(result.failureRateDelta).toBe(0);
    expect(result.sentimentMultiplier).toBe(1.0);
  });

  it("returns high risk for degraded metrics", () => {
    const input: RiskInput = { doraMetrics: makeDoraMetrics(500, 60) };
    const result = computeRiskScore(input);
    expect(result.score).toBeGreaterThan(50);
    expect(["high", "critical"]).toContain(result.level);
  });

  it("applies sentiment multiplier when negative ratio is provided", () => {
    const base: RiskInput = { doraMetrics: makeDoraMetrics(200, 30) };
    const withSentiment: RiskInput = {
      doraMetrics: makeDoraMetrics(200, 30),
      sentimentNegativeRatio: 0.8,
    };

    const baseResult = computeRiskScore(base);
    const sentimentResult = computeRiskScore(withSentiment);

    expect(sentimentResult.score).toBeGreaterThan(baseResult.score);
    expect(sentimentResult.sentimentMultiplier).toBeGreaterThan(1.0);
  });

  it("caps score at 100", () => {
    const input: RiskInput = {
      doraMetrics: makeDoraMetrics(720, 100),
      sentimentNegativeRatio: 1.0,
    };
    const result = computeRiskScore(input);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("includes a summary string", () => {
    const input: RiskInput = { doraMetrics: makeDoraMetrics(100, 20) };
    const result = computeRiskScore(input);
    expect(result.summary).toBeTruthy();
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(10);
  });

  it("does not apply sentiment when ratio is 0", () => {
    const input: RiskInput = {
      doraMetrics: makeDoraMetrics(200, 30),
      sentimentNegativeRatio: 0,
    };
    const result = computeRiskScore(input);
    expect(result.sentimentMultiplier).toBe(1.0);
  });

  it("clamps sentimentNegativeRatio to [0, 1]", () => {
    const overOne: RiskInput = {
      doraMetrics: makeDoraMetrics(200, 30),
      sentimentNegativeRatio: 2.5,
    };
    const result = computeRiskScore(overOne);
    // Clamped to 1.0 → multiplier = 1.0 + 1.0 * 0.5 = 1.5
    expect(result.sentimentMultiplier).toBe(1.5);

    const negative: RiskInput = {
      doraMetrics: makeDoraMetrics(200, 30),
      sentimentNegativeRatio: -0.5,
    };
    const negResult = computeRiskScore(negative);
    // Clamped to 0 → multiplier stays 1.0
    expect(negResult.sentimentMultiplier).toBe(1.0);
  });

  it("produces consistent deltas between 0 and 1", () => {
    const input: RiskInput = { doraMetrics: makeDoraMetrics(300, 50) };
    const result = computeRiskScore(input);
    expect(result.cycleTimeDelta).toBeGreaterThanOrEqual(0);
    expect(result.cycleTimeDelta).toBeLessThanOrEqual(1);
    expect(result.failureRateDelta).toBeGreaterThanOrEqual(0);
    expect(result.failureRateDelta).toBeLessThanOrEqual(1);
  });

  it("correctly weights cycle time at 0.6 and failure rate at 0.4", () => {
    // Only cycle time is bad → score is driven by 0.6 weight
    const cycleOnly: RiskInput = { doraMetrics: makeDoraMetrics(720, 5) };
    const failOnly: RiskInput = { doraMetrics: makeDoraMetrics(24, 100) };

    const cycleResult = computeRiskScore(cycleOnly);
    const failResult = computeRiskScore(failOnly);

    // Cycle time at max (delta=1) × 0.6 × 100 = 60
    expect(cycleResult.score).toBe(60);
    // Failure rate at max (delta=1) × 0.4 × 100 = 40
    expect(failResult.score).toBe(40);
  });
});
