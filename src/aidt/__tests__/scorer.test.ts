import { describe, it, expect } from "vitest";
import {
  computeRiskWeight,
  resolveCanaryDuration,
  resolveRiskTier,
  buildRecommendation,
  BASELINE_FALLBACK,
} from "../scorer";

describe("BASELINE_FALLBACK", () => {
  it("is 6.0 seconds/line", () => {
    expect(BASELINE_FALLBACK).toBe(6.0);
  });
});

describe("computeRiskWeight", () => {
  it("returns 0.0 when authorship is zero and review density equals baseline", () => {
    expect(computeRiskWeight(0.0, 6.0, 6.0)).toBe(0.0);
  });

  it("returns 0.6 when authorship is 1.0 and review density equals baseline (density_risk = 0)", () => {
    expect(computeRiskWeight(1.0, 6.0, 6.0)).toBe(0.6);
  });

  it("returns 0.4 when authorship is 0.0 and review density is zero (density_risk = 1)", () => {
    expect(computeRiskWeight(0.0, 0.0, 6.0)).toBe(0.4);
  });

  it("returns 1.0 at maximum authorship and zero review density", () => {
    expect(computeRiskWeight(1.0, 0.0, 6.0)).toBe(1.0);
  });

  it("rounds to 3 decimal places", () => {
    const result = computeRiskWeight(0.5, 3.0, 6.0);
    expect(result).toBe(0.5);
    expect(result.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });

  it("clamps density_risk to 0 when review_time_per_loc exceeds baseline", () => {
    // review_time_per_loc = 12, baseline = 6 → density_risk = max(0, 1 - 2) = 0
    expect(computeRiskWeight(0.5, 12.0, 6.0)).toBe(0.3);
  });

  it("produces value between 0 and 1 for boundary inputs", () => {
    const r = computeRiskWeight(0.45, 2.0, 6.0);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });

  it("exactly at high threshold", () => {
    // 0.7 authorship, 0 density → 0.7*0.6 + 1.0*0.4 = 0.42 + 0.4 = 0.82
    const r = computeRiskWeight(0.7, 0, 6.0);
    expect(r).toBeCloseTo(0.82, 3);
  });
});

describe("resolveCanaryDuration", () => {
  it("returns 30 for risk weight ≤ 0.45", () => {
    expect(resolveCanaryDuration(0.0)).toBe(30);
    expect(resolveCanaryDuration(0.45)).toBe(30);
  });

  it("returns 60 for risk weight in (0.45, 0.70]", () => {
    expect(resolveCanaryDuration(0.46)).toBe(60);
    expect(resolveCanaryDuration(0.7)).toBe(60);
  });

  it("returns 240 for risk weight > 0.70", () => {
    expect(resolveCanaryDuration(0.701)).toBe(240);
    expect(resolveCanaryDuration(1.0)).toBe(240);
  });
});

describe("resolveRiskTier", () => {
  it("returns 'low' for risk weight ≤ 0.45", () => {
    expect(resolveRiskTier(0.0)).toBe("low");
    expect(resolveRiskTier(0.45)).toBe("low");
  });

  it("returns 'medium' for risk weight in (0.45, 0.70]", () => {
    expect(resolveRiskTier(0.46)).toBe("medium");
    expect(resolveRiskTier(0.7)).toBe("medium");
  });

  it("returns 'high' for risk weight > 0.70", () => {
    expect(resolveRiskTier(0.701)).toBe("high");
    expect(resolveRiskTier(1.0)).toBe("high");
  });
});

describe("buildRecommendation", () => {
  it("mentions 240 minutes for high tier", () => {
    const rec = buildRecommendation("high", 240);
    expect(rec).toContain("240");
  });

  it("mentions 60 minutes for medium tier", () => {
    const rec = buildRecommendation("medium", 60);
    expect(rec).toContain("60");
  });

  it("mentions 30 minutes for low tier", () => {
    const rec = buildRecommendation("low", 30);
    expect(rec).toContain("30");
  });

  it("returns a non-empty string for all tiers", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      expect(buildRecommendation(tier, 30).length).toBeGreaterThan(0);
    }
  });
});
