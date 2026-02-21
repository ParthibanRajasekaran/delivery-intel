import { describe, it, expect } from "vitest";
import { sparkline, renderCyberReport } from "../cli/cyberRenderer";
import type { AnalysisResult } from "../cli/analyzer";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp("\x1b\\[[0-9;]*m", "g");

/** Strip ANSI escape codes to get raw visible text */
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Build a minimal AnalysisResult fixture */
function makeResult(
  overrides: Partial<{
    score: number;
    vulns: AnalysisResult["vulnerabilities"];
    suggestions: AnalysisResult["suggestions"];
    daily: number[];
    deployRating: string;
    leadRating: string;
    cfrRating: string;
  }> = {},
): AnalysisResult {
  return {
    repo: { owner: "acme", repo: "widget" },
    fetchedAt: "2026-02-20T00:00:00.000Z",
    doraMetrics: {
      deploymentFrequency: {
        deploymentsPerWeek: 5,
        rating: overrides.deployRating ?? "High",
        source: "deployments_api",
      },
      leadTimeForChanges: {
        medianHours: 12,
        rating: overrides.leadRating ?? "Elite",
      },
      changeFailureRate: {
        percentage: 3,
        failedRuns: 1,
        totalRuns: 30,
        rating: overrides.cfrRating ?? "Elite",
      },
    },
    vulnerabilities: overrides.vulns ?? [],
    suggestions: overrides.suggestions ?? [],
    overallScore: overrides.score ?? 85,
    dailyDeployments: overrides.daily ?? [0, 1, 2, 0, 3, 1, 0],
  };
}

// ---------------------------------------------------------------------------
// sparkline
// ---------------------------------------------------------------------------

describe("sparkline", () => {
  it("renders 7-character output for 7-value input", () => {
    const raw = stripAnsi(sparkline([0, 1, 2, 3, 4, 5, 6]));
    expect(raw).toHaveLength(7);
  });

  it("uses block characters ▁–█", () => {
    const raw = stripAnsi(sparkline([0, 0, 0, 0, 0, 0, 7]));
    expect(raw[6]).toBe("█");
  });

  it("handles all-zero values without dividing by zero", () => {
    const raw = stripAnsi(sparkline([0, 0, 0, 0, 0, 0, 0]));
    expect(raw).toHaveLength(7);
  });

  it("handles uniform values", () => {
    const raw = stripAnsi(sparkline([3, 3, 3, 3, 3, 3, 3]));
    expect(new Set(raw.split("")).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// renderCyberReport  (full integration through the public API)
// ---------------------------------------------------------------------------

describe("renderCyberReport", () => {
  // ── Banner ──────────────────────────────────────────────────────────────
  it("contains the repo owner/name", () => {
    const out = stripAnsi(renderCyberReport(makeResult()));
    expect(out).toContain("acme/widget");
  });

  it("contains the Delivery Intel header", () => {
    const out = stripAnsi(renderCyberReport(makeResult()));
    expect(out).toContain("Delivery Intel");
  });

  it("contains the fetchedAt timestamp", () => {
    const out = stripAnsi(renderCyberReport(makeResult()));
    expect(out).toContain("2026-02-20");
  });

  // ── Health score ────────────────────────────────────────────────────────
  it("shows EXCELLENT label for score >= 80", () => {
    const out = stripAnsi(renderCyberReport(makeResult({ score: 80 })));
    expect(out).toContain("EXCELLENT");
  });

  it("shows EXCELLENT label for score 90", () => {
    const out = stripAnsi(renderCyberReport(makeResult({ score: 90 })));
    expect(out).toContain("EXCELLENT");
  });

  it("shows MODERATE label for score 50-79", () => {
    const out = stripAnsi(renderCyberReport(makeResult({ score: 65 })));
    expect(out).toContain("MODERATE");
  });

  it("shows CRITICAL label for score < 50", () => {
    const out = stripAnsi(renderCyberReport(makeResult({ score: 30 })));
    expect(out).toContain("CRITICAL");
  });

  it("includes the numeric score", () => {
    const out = stripAnsi(renderCyberReport(makeResult({ score: 42 })));
    expect(out).toContain("42");
    expect(out).toContain("/100");
  });

  // ── DORA metrics ────────────────────────────────────────────────────────
  it("includes Deploy Frequency section", () => {
    const out = stripAnsi(renderCyberReport(makeResult()));
    expect(out).toContain("Deploy Frequency");
    expect(out).toContain("deployments/week");
  });

  it("includes Lead Time section", () => {
    const out = stripAnsi(renderCyberReport(makeResult()));
    expect(out).toContain("Lead Time");
    expect(out).toContain("hours median");
  });

  it("includes Change Failure Rate section", () => {
    const out = stripAnsi(renderCyberReport(makeResult()));
    expect(out).toContain("Change Failure Rate");
  });

  it("shows sparkline bar characters", () => {
    const out = stripAnsi(renderCyberReport(makeResult({ daily: [0, 0, 0, 0, 0, 0, 5] })));
    expect(out).toMatch(/[▁▂▃▄▅▆▇█]/);
  });

  it("renders all rating badges", () => {
    const out = stripAnsi(
      renderCyberReport(
        makeResult({
          deployRating: "Elite",
          leadRating: "Medium",
          cfrRating: "Low",
        }),
      ),
    );
    expect(out).toContain("★ Elite");
    expect(out).toContain("◆ Medium");
    expect(out).toContain("▼ Low");
  });

  // ── Vulnerabilities ─────────────────────────────────────────────────────
  it("shows clean message when no vulnerabilities", () => {
    const out = stripAnsi(renderCyberReport(makeResult({ vulns: [] })));
    expect(out).toContain("No known vulnerabilities found");
  });

  it("groups vulnerabilities by severity", () => {
    const vulns = [
      {
        packageName: "lodash",
        currentVersion: "4.0.0",
        vulnId: "GHSA-1",
        summary: "proto pollution",
        severity: "critical",
        aliases: [],
        fixedVersion: "4.17.21",
      },
      {
        packageName: "express",
        currentVersion: "4.0.0",
        vulnId: "GHSA-2",
        summary: "open redirect",
        severity: "high",
        aliases: [],
        fixedVersion: null,
      },
    ];
    const out = stripAnsi(renderCyberReport(makeResult({ vulns })));
    expect(out).toContain("CRITICAL");
    expect(out).toContain("HIGH");
    expect(out).toContain("lodash");
    expect(out).toContain("express");
    expect(out).toContain("→ 4.17.21");
    expect(out).toContain("no fix");
  });

  it("shows count of vulnerabilities found", () => {
    const vulns = [
      {
        packageName: "pkg",
        currentVersion: "1.0.0",
        vulnId: "GHSA-x",
        summary: "test",
        severity: "medium",
        aliases: [],
        fixedVersion: null,
      },
    ];
    const out = stripAnsi(renderCyberReport(makeResult({ vulns })));
    expect(out).toContain("1 vulnerability found");
  });

  it("pluralizes correctly for multiple vulns", () => {
    const vulns = Array.from({ length: 3 }, (_, i) => ({
      packageName: `pkg-${i}`,
      currentVersion: "1.0.0",
      vulnId: `GHSA-${i}`,
      summary: "test",
      severity: "low",
      aliases: [] as string[],
      fixedVersion: null,
    }));
    const out = stripAnsi(renderCyberReport(makeResult({ vulns })));
    expect(out).toContain("3 vulnerabilities found");
  });

  // ── Suggestions ─────────────────────────────────────────────────────────
  it("renders suggestion categories with correct icons (in raw text)", () => {
    const suggestions: AnalysisResult["suggestions"] = [
      {
        category: "security",
        severity: "high",
        title: "Fix Vulns",
        description: "Update packages",
        actionItems: ["Run npm audit fix"],
      },
      {
        category: "performance",
        severity: "medium",
        title: "Speed Up",
        description: "Faster deploys",
        actionItems: ["Use caching"],
      },
    ];
    const out = stripAnsi(renderCyberReport(makeResult({ suggestions })));
    expect(out).toContain("Fix Vulns");
    expect(out).toContain("Speed Up");
    expect(out).toContain("Run npm audit fix");
  });

  // ── Footer ──────────────────────────────────────────────────────────────
  it("includes the project URL in the footer", () => {
    const out = stripAnsi(renderCyberReport(makeResult()));
    expect(out).toContain("delivery-intel");
    expect(out).toContain("Powered by");
  });
});
