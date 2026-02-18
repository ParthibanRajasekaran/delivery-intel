import { describe, it, expect } from "vitest";
import { generateSuggestions, computeOverallScore } from "@/lib/suggestions";
import type { DORAMetrics, DependencyVulnerability } from "@/types";

// ---------------------------------------------------------------------------
// Helper: Build a DORAMetrics fixture with overrides
// ---------------------------------------------------------------------------

function makeDORA(overrides: Partial<{
  deployFreq: number;
  deployRating: string;
  deploySource: string;
  leadHours: number;
  leadRating: string;
  cfrPct: number;
  cfrRating: string;
  cfrFailed: number;
  cfrTotal: number;
}>): DORAMetrics {
  return {
    deploymentFrequency: {
      deploymentsPerWeek: overrides.deployFreq ?? 5,
      rating: (overrides.deployRating ?? "High") as DORAMetrics["deploymentFrequency"]["rating"],
      source: (overrides.deploySource ?? "deployments_api") as "deployments_api" | "merged_prs_fallback",
    },
    leadTimeForChanges: {
      medianHours: overrides.leadHours ?? 12,
      rating: (overrides.leadRating ?? "Elite") as DORAMetrics["leadTimeForChanges"]["rating"],
    },
    changeFailureRate: {
      percentage: overrides.cfrPct ?? 3,
      failedRuns: overrides.cfrFailed ?? 1,
      totalRuns: overrides.cfrTotal ?? 30,
      rating: (overrides.cfrRating ?? "Elite") as DORAMetrics["changeFailureRate"]["rating"],
    },
    meanTimeToRestore: { medianHours: null, rating: "N/A" },
  };
}

function makeVuln(
  severity: "critical" | "high" | "medium" | "low",
  pkg = "test-pkg",
): DependencyVulnerability {
  return {
    packageName: pkg,
    currentVersion: "1.0.0",
    vulnId: `GHSA-${severity}-001`,
    severity,
    summary: `A ${severity} vulnerability in ${pkg}`,
    fixedVersion: "2.0.0",
    aliases: [],
  };
}

// =========================================================================
// generateSuggestions
// =========================================================================

describe("generateSuggestions", () => {
  it("returns high-severity suggestion when CFR exceeds 15%", () => {
    const dora = makeDORA({ cfrPct: 20, cfrRating: "Low" });
    const suggestions = generateSuggestions(dora, []);

    const cfr = suggestions.find((s) => s.title.includes("High Pipeline Failure Rate"));
    expect(cfr).toBeDefined();
    expect(cfr!.severity).toBe("high");
    expect(cfr!.category).toBe("reliability");
    expect(cfr!.actionItems.length).toBeGreaterThan(0);
  });

  it("returns medium-severity suggestion when CFR is between 10%–15%", () => {
    const dora = makeDORA({ cfrPct: 12, cfrRating: "Medium" });
    const suggestions = generateSuggestions(dora, []);

    const cfr = suggestions.find((s) => s.title.includes("Moderate Pipeline Failure Rate"));
    expect(cfr).toBeDefined();
    expect(cfr!.severity).toBe("medium");
  });

  it("returns no CFR suggestion when failure rate is low", () => {
    const dora = makeDORA({ cfrPct: 3, cfrRating: "Elite" });
    const suggestions = generateSuggestions(dora, []);

    const cfr = suggestions.find((s) => s.title.toLowerCase().includes("failure rate"));
    expect(cfr).toBeUndefined();
  });

  it("flags slow lead time (> 1 week)", () => {
    const dora = makeDORA({ leadHours: 200, leadRating: "Low" });
    const suggestions = generateSuggestions(dora, []);

    const lt = suggestions.find((s) => s.title.includes("Slow Lead Time"));
    expect(lt).toBeDefined();
    expect(lt!.severity).toBe("high");
  });

  it("flags moderate lead time (> 48h but < 1 week)", () => {
    const dora = makeDORA({ leadHours: 72, leadRating: "Medium" });
    const suggestions = generateSuggestions(dora, []);

    const lt = suggestions.find((s) => s.title.includes("Sitting Too Long"));
    expect(lt).toBeDefined();
    expect(lt!.severity).toBe("medium");
  });

  it("flags low deployment frequency", () => {
    const dora = makeDORA({ deployFreq: 0.1, deployRating: "Low" });
    const suggestions = generateSuggestions(dora, []);

    const df = suggestions.find((s) => s.title.includes("Low Deployment Frequency"));
    expect(df).toBeDefined();
  });

  it("suggests formal deployment tracking when using PR fallback", () => {
    const dora = makeDORA({ deploySource: "merged_prs_fallback" });
    const suggestions = generateSuggestions(dora, []);

    const fb = suggestions.find((s) => s.title.includes("No Formal Deployment Tracking"));
    expect(fb).toBeDefined();
  });

  it("surfaces critical vulnerabilities as high-severity suggestions", () => {
    const dora = makeDORA({});
    const vulns = [makeVuln("critical", "lodash"), makeVuln("critical", "express")];
    const suggestions = generateSuggestions(dora, vulns);

    const sec = suggestions.find((s) => s.title.includes("Critical Vulnerabilit"));
    expect(sec).toBeDefined();
    expect(sec!.severity).toBe("high");
    expect(sec!.category).toBe("security");
  });

  it("surfaces high vulnerabilities as medium-severity suggestions", () => {
    const dora = makeDORA({});
    const vulns = [makeVuln("high", "axios")];
    const suggestions = generateSuggestions(dora, vulns);

    const sec = suggestions.find((s) => s.title.includes("High-Severity Vulnerabilit"));
    expect(sec).toBeDefined();
    expect(sec!.severity).toBe("medium");
  });

  it("gives positive feedback when no vulnerabilities found", () => {
    const dora = makeDORA({});
    const suggestions = generateSuggestions(dora, []);

    const safe = suggestions.find((s) => s.title.includes("No Known Vulnerabilities"));
    expect(safe).toBeDefined();
    expect(safe!.severity).toBe("low");
  });

  it("sorts suggestions by severity: high → medium → low", () => {
    const dora = makeDORA({ cfrPct: 20, cfrRating: "Low", leadHours: 200, leadRating: "Low" });
    const vulns = [makeVuln("high"), makeVuln("critical")];
    const suggestions = generateSuggestions(dora, vulns);

    const severities = suggestions.map((s) => s.severity);
    const highIdx = severities.indexOf("high");
    const medIdx = severities.indexOf("medium");
    const lowIdx = severities.indexOf("low");

    if (highIdx !== -1 && medIdx !== -1) {
      expect(highIdx).toBeLessThan(medIdx);
    }
    if (medIdx !== -1 && lowIdx !== -1) {
      expect(medIdx).toBeLessThan(lowIdx);
    }
  });
});

// =========================================================================
// computeOverallScore
// =========================================================================

describe("computeOverallScore", () => {
  it("returns 100 for an Elite repo with no vulnerabilities", () => {
    const dora = makeDORA({
      deployRating: "Elite",
      leadRating: "Elite",
      cfrRating: "Elite",
    });
    expect(computeOverallScore(dora, [])).toBe(100);
  });

  it("returns 25 for a Low-rated repo with no vulnerabilities", () => {
    const dora = makeDORA({
      deployRating: "Low",
      leadRating: "Low",
      cfrRating: "Low",
    });
    expect(computeOverallScore(dora, [])).toBe(25);
  });

  it("penalises critical vulnerabilities by 5 points each", () => {
    const dora = makeDORA({
      deployRating: "Elite",
      leadRating: "Elite",
      cfrRating: "Elite",
    });
    const vulns = [makeVuln("critical"), makeVuln("critical")];
    expect(computeOverallScore(dora, vulns)).toBe(90);
  });

  it("penalises high vulnerabilities by 2 points each", () => {
    const dora = makeDORA({
      deployRating: "Elite",
      leadRating: "Elite",
      cfrRating: "Elite",
    });
    const vulns = [makeVuln("high"), makeVuln("high"), makeVuln("high")];
    expect(computeOverallScore(dora, vulns)).toBe(94);
  });

  it("never goes below 0", () => {
    const dora = makeDORA({
      deployRating: "Low",
      leadRating: "Low",
      cfrRating: "Low",
    });
    // 25 base, minus 30 critical vulnerabilities * 5 = way below 0
    const vulns = Array.from({ length: 30 }, () => makeVuln("critical"));
    expect(computeOverallScore(dora, vulns)).toBe(0);
  });

  it("never exceeds 100", () => {
    const dora = makeDORA({
      deployRating: "Elite",
      leadRating: "Elite",
      cfrRating: "Elite",
    });
    expect(computeOverallScore(dora, [])).toBeLessThanOrEqual(100);
  });

  it("computes a blended score for mixed ratings", () => {
    const dora = makeDORA({
      deployRating: "Elite",  // 100
      leadRating: "Medium",   // 50
      cfrRating: "High",      // 75
    });
    // Average: (100 + 50 + 75) / 3 ≈ 75
    expect(computeOverallScore(dora, [])).toBe(75);
  });
});
