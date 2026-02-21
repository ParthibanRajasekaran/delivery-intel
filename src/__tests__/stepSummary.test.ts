import { describe, it, expect, vi, afterEach } from "vitest";
import { svgProgressRing, generateStepSummaryMarkdown, writeStepSummary } from "../cli/stepSummary";
import type { AnalysisResult } from "../cli/analyzer";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, appendFileSync: vi.fn() };
});

import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeResult(score: number): AnalysisResult {
  return {
    repo: { owner: "test", repo: "repo" },
    fetchedAt: "2026-02-20T00:00:00.000Z",
    doraMetrics: {
      deploymentFrequency: {
        deploymentsPerWeek: 5,
        rating: "High",
        source: "deployments_api",
      },
      leadTimeForChanges: { medianHours: 12, rating: "Elite" },
      changeFailureRate: {
        percentage: 3,
        failedRuns: 1,
        totalRuns: 30,
        rating: "Elite",
      },
    },
    vulnerabilities: [],
    suggestions: [],
    overallScore: score,
    dailyDeployments: [0, 1, 2, 0, 3, 1, 0],
  };
}

// ---------------------------------------------------------------------------
// SVG Progress Ring
// ---------------------------------------------------------------------------

describe("svgProgressRing", () => {
  it("returns a valid SVG string", () => {
    const svg = svgProgressRing(75);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("uses green color for score >= 80", () => {
    const svg = svgProgressRing(90);
    expect(svg).toContain("#39ff14");
  });

  it("uses green color for score exactly 80", () => {
    const svg = svgProgressRing(80);
    expect(svg).toContain("#39ff14");
  });

  it("uses yellow/amber color for score 50-79", () => {
    const svg = svgProgressRing(65);
    expect(svg).toContain("#ffbe0b");
  });

  it("uses red color for score < 50", () => {
    const svg = svgProgressRing(30);
    expect(svg).toContain("#ff073a");
  });

  it("includes stroke-dasharray for the progress circle", () => {
    const svg = svgProgressRing(50);
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("stroke-dashoffset");
  });

  it("displays the score as text", () => {
    const svg = svgProgressRing(42);
    expect(svg).toContain(">42</text>");
  });

  it("respects custom size parameter", () => {
    const svg = svgProgressRing(75, 200);
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="200"');
  });
});

// ---------------------------------------------------------------------------
// Step Summary Markdown
// ---------------------------------------------------------------------------

describe("generateStepSummaryMarkdown", () => {
  it("contains the report header", () => {
    const md = generateStepSummaryMarkdown(makeResult(85));
    expect(md).toContain("Delivery Intel");
    expect(md).toContain("Cyber-Diagnostic Report");
  });

  it("embeds an SVG progress ring", () => {
    const md = generateStepSummaryMarkdown(makeResult(75));
    expect(md).toContain("<svg");
    expect(md).toContain("stroke-dasharray");
  });

  it("includes DORA metrics table", () => {
    const md = generateStepSummaryMarkdown(makeResult(75));
    expect(md).toContain("DORA Metrics");
    expect(md).toContain("Deploy Frequency");
    expect(md).toContain("Lead Time");
    expect(md).toContain("Change Failure Rate");
  });

  it("shows sparkline characters in deploy frequency", () => {
    const md = generateStepSummaryMarkdown(makeResult(75));
    // Should contain at least one sparkline block character
    expect(md).toMatch(/[▁▂▃▄▅▆▇█]/);
  });

  it("includes benchmark references", () => {
    const md = generateStepSummaryMarkdown(makeResult(75));
    expect(md).toContain("Elite");
  });

  it("shows vulnerability section", () => {
    const md = generateStepSummaryMarkdown(makeResult(75));
    expect(md).toContain("Vulnerabilities");
  });

  it("shows no-vuln message when clean", () => {
    const md = generateStepSummaryMarkdown(makeResult(100));
    expect(md).toContain("No known vulnerabilities");
  });

  it("renders vulnerability table when vulns exist", () => {
    const result = makeResult(50);
    result.vulnerabilities = [
      {
        packageName: "lodash",
        currentVersion: "4.17.20",
        vulnId: "GHSA-1234",
        summary: "Prototype pollution",
        severity: "critical",
        aliases: [],
        fixedVersion: "4.17.21",
      },
    ];
    const md = generateStepSummaryMarkdown(result);
    expect(md).toContain("lodash");
    expect(md).toContain("CRITICAL");
    expect(md).toContain("4.17.21");
  });

  it("includes footer with repo link", () => {
    const md = generateStepSummaryMarkdown(makeResult(75));
    expect(md).toContain("delivery-intel");
  });

  it("renders score label correctly for each tier", () => {
    expect(generateStepSummaryMarkdown(makeResult(90))).toContain("Excellent");
    expect(generateStepSummaryMarkdown(makeResult(65))).toContain("Moderate");
    expect(generateStepSummaryMarkdown(makeResult(30))).toContain("Critical");
  });

  it("renders suggestions with per-category icons", () => {
    const result = makeResult(60);
    result.suggestions = [
      {
        category: "security",
        severity: "high",
        title: "Critical Vuln",
        description: "Fix it",
        actionItems: ["Update"],
      },
      {
        category: "reliability",
        severity: "medium",
        title: "Flaky Tests",
        description: "Stabilize",
        actionItems: ["Retry"],
      },
      {
        category: "performance",
        severity: "low",
        title: "Slow CI",
        description: "Optimize",
        actionItems: ["Cache"],
      },
    ];
    const md = generateStepSummaryMarkdown(result);

    expect(md).toContain("🔒"); // security
    expect(md).toContain("🛡️"); // reliability
    expect(md).toContain("⚡"); // performance
    expect(md).toContain("Critical Vuln");
  });

  it("truncates when more than 15 vulnerabilities", () => {
    const result = makeResult(20);
    result.vulnerabilities = Array.from({ length: 18 }, (_, i) => ({
      packageName: `pkg-${i}`,
      currentVersion: "1.0.0",
      vulnId: `GHSA-${i}`,
      summary: "Issue",
      severity: "high",
      aliases: [],
      fixedVersion: null,
    }));
    const md = generateStepSummaryMarkdown(result);

    expect(md).toContain("…and 3 more");
  });

  it("renders N/A and unknown rating emojis", () => {
    const result = makeResult(50);
    result.doraMetrics.deploymentFrequency.rating = "Low";
    result.doraMetrics.leadTimeForChanges.rating = "Medium";
    result.doraMetrics.changeFailureRate.rating = "N/A" as string;
    const md = generateStepSummaryMarkdown(result);

    // Low → 🔴, Medium → 🟡, N/A → ⚪ (default)
    expect(md).toContain("🔴");
    expect(md).toContain("🟡");
    expect(md).toContain("⚪");
  });
});

// ---------------------------------------------------------------------------
// writeStepSummary
// ---------------------------------------------------------------------------

describe("writeStepSummary", () => {
  const origEnv = process.env.GITHUB_STEP_SUMMARY;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.GITHUB_STEP_SUMMARY;
    } else {
      process.env.GITHUB_STEP_SUMMARY = origEnv;
    }
    vi.restoreAllMocks();
  });

  it("returns false when GITHUB_STEP_SUMMARY is not set", () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    expect(writeStepSummary(makeResult(80))).toBe(false);
  });

  it("returns true and writes file when GITHUB_STEP_SUMMARY is set", () => {
    process.env.GITHUB_STEP_SUMMARY = "step-summary-test.md";
    const mock = vi.mocked(fs.appendFileSync);
    mock.mockImplementation(() => {});

    expect(writeStepSummary(makeResult(80))).toBe(true);
    expect(mock).toHaveBeenCalledOnce();
  });

  it("returns false when fs.appendFileSync throws", () => {
    process.env.GITHUB_STEP_SUMMARY = "step-summary-test.md";
    vi.mocked(fs.appendFileSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(writeStepSummary(makeResult(80))).toBe(false);
  });
});
