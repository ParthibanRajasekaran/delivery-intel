import { describe, it, expect } from "vitest";
import {
  checkCoverage,
  renderHygieneMarkdown,
  type HygieneReport,
  type HygieneCheck,
} from "../cli/hygieneCheck";

// ---------------------------------------------------------------------------
// checkCoverage (pure function — no API calls)
// ---------------------------------------------------------------------------
describe("checkCoverage", () => {
  it("passes when coverage >= 80%", () => {
    const result = checkCoverage(85);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("85.0%");
  });

  it("passes at exactly 80%", () => {
    const result = checkCoverage(80);
    expect(result.status).toBe("pass");
  });

  it("fails when coverage < 80%", () => {
    const result = checkCoverage(60);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("60.0%");
    expect(result.detail).toContain("80%");
  });

  it("warns when coverage is undefined", () => {
    const result = checkCoverage(undefined);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("skipping");
  });

  it("passes at 100%", () => {
    const result = checkCoverage(100);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("100.0%");
  });

  it("fails at 0%", () => {
    const result = checkCoverage(0);
    expect(result.status).toBe("fail");
  });
});

// ---------------------------------------------------------------------------
// renderHygieneMarkdown
// ---------------------------------------------------------------------------
describe("renderHygieneMarkdown", () => {
  function makeReport(checks: HygieneCheck[], overall: "pass" | "fail" | "warn"): HygieneReport {
    return {
      repo: "test/repo",
      timestamp: "2025-01-01T00:00:00Z",
      checks,
      overallStatus: overall,
      markdownSummary: "",
    };
  }

  it("renders a passing report with ✅", () => {
    const report = makeReport([{ name: "README.md", status: "pass", detail: "Present" }], "pass");
    const md = renderHygieneMarkdown(report);
    expect(md).toContain("✅");
    expect(md).toContain("Engineering Hygiene Report");
    expect(md).toContain("test/repo");
    expect(md).toContain("PASS");
  });

  it("renders a failing report with ❌", () => {
    const report = makeReport([{ name: "Coverage", status: "fail", detail: "50% < 80%" }], "fail");
    const md = renderHygieneMarkdown(report);
    expect(md).toContain("❌");
    expect(md).toContain("FAIL");
    expect(md).toContain("1 check(s) failed");
  });

  it("includes table headers", () => {
    const report = makeReport([{ name: "Test", status: "pass", detail: "OK" }], "pass");
    const md = renderHygieneMarkdown(report);
    expect(md).toContain("| Check | Status | Detail |");
  });

  it("renders multiple checks in the table", () => {
    const report = makeReport(
      [
        { name: "README.md", status: "pass", detail: "Present" },
        { name: "Coverage", status: "fail", detail: "Low" },
        { name: "Stale PRs", status: "warn", detail: "Unknown" },
      ],
      "fail",
    );
    const md = renderHygieneMarkdown(report);
    expect(md).toContain("README.md");
    expect(md).toContain("Coverage");
    expect(md).toContain("Stale PRs");
    expect(md).toContain("⚠️");
  });

  it("shows congratulations when all checks pass", () => {
    const report = makeReport([{ name: "All Good", status: "pass", detail: "Excellent" }], "pass");
    const md = renderHygieneMarkdown(report);
    expect(md).toContain("All checks passed");
    expect(md).toContain("🎉");
  });
});
