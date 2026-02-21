import { describe, it, expect } from "vitest";
import { svgProgressRing, generateStepSummaryMarkdown } from "../cli/stepSummary";
import type { AnalysisResult } from "../cli/analyzer";

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
});
