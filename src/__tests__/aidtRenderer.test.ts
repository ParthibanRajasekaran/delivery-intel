import { afterEach, describe, expect, it } from "vitest";
import chalk from "chalk";
import { renderAidtResult } from "../cli/aidtRenderer";
import type { AidtResult } from "../aidt/types";

const result: AidtResult = {
  pr_number: 42,
  ai_authorship_pct: 0.4,
  review_time_per_loc: 6,
  baseline_density: 6,
  risk_weight: 0.24,
  canary_duration_minutes: 30,
  risk_tier: "low",
  authorship_signals: {
    description_match: false,
    diff_entropy_score: 0.1234,
    copilot_acceptance_rate: null,
  },
  baseline_source: "fallback",
  recommendation: "Use a 30 minute canary.",
};

const originalLevel = chalk.level;
afterEach(() => {
  chalk.level = originalLevel;
});

describe("renderAidtResult", () => {
  it("renders the PR, formatted metrics, baseline source and recommendation", () => {
    chalk.level = 0;
    const output = renderAidtResult(result);
    expect(output).toContain("AIDT Canary Trust Score  ·  PR #42");
    expect(output).toContain("AI authorship    0.400   (low)");
    expect(output).toContain("Review density   6.0s/loc  (at or above baseline)");
    expect(output).toContain("Baseline density 6.0s/loc  (fallback)");
    expect(output).toContain("Risk weight      0.240");
    expect(output).toContain("Canary duration  30 min  ● LOW");
    expect(output).toContain("description=none  entropy=0.123");
    expect(output).not.toContain("copilot=");
    expect(output).toContain("Recommendation: Use a 30 minute canary.");
  });

  it.each([
    ["low", "● LOW"],
    ["medium", "●● MEDIUM"],
    ["high", "●●● HIGH"],
  ] as const)("renders the %s risk tier", (risk_tier, label) => {
    expect(renderAidtResult({ ...result, risk_tier })).toContain(label);
  });

  it.each([
    [0.4, "low"],
    [0.401, "moderate"],
    [0.7, "moderate"],
    [0.701, "high"],
  ] as const)("labels authorship %s as %s", (ai_authorship_pct, label) => {
    chalk.level = 0;
    expect(renderAidtResult({ ...result, ai_authorship_pct })).toContain(`(${label})`);
  });

  it("renders below-baseline review density and optional authorship signals", () => {
    chalk.level = 0;
    const output = renderAidtResult({
      ...result,
      review_time_per_loc: 3,
      baseline_source: "computed",
      authorship_signals: {
        description_match: true,
        diff_entropy_score: 0.9876,
        copilot_acceptance_rate: 0,
      },
    });
    expect(output).toContain("3.0s/loc  (below baseline)");
    expect(output).toContain("(computed)");
    expect(output).toContain("description=match  entropy=0.988  copilot=0.00");
  });

  it("wraps long recommendations at word boundaries without losing words", () => {
    chalk.level = 0;
    const recommendation =
      "Extend the canary window and monitor error rates before promoting this deployment to production.";
    const output = renderAidtResult({ ...result, recommendation });
    const lines = output.split("\n");
    const start = lines.findIndex((line) => line.includes("Recommendation:"));
    const recommendationLines = lines.slice(start, -2);
    expect(recommendationLines.length).toBeGreaterThan(1);
    const text = recommendationLines.map((line) => line.slice(2, -2).trim()).join(" ");
    expect(text).toBe(`Recommendation: ${recommendation}`);
    expect(recommendationLines.every((line) => line.length <= 57)).toBe(true);
  });

  it("handles an empty recommendation", () => {
    chalk.level = 0;
    const output = renderAidtResult({ ...result, recommendation: "" });
    expect(output).toContain("Recommendation:");
    expect(output).not.toContain("undefined");
  });

  it("preserves a word longer than the wrapping width", () => {
    const recommendation = "x".repeat(70);
    expect(renderAidtResult({ ...result, recommendation })).toContain(recommendation);
  });
});
