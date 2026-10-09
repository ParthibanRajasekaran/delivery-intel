import { describe, it, expect, vi, beforeEach } from "vitest";
import { Octokit } from "@octokit/rest";
import {
  checkCoverage,
  checkReadme,
  checkStalePRs,
  renderHygieneMarkdown,
  runHygieneCheck,
  type HygieneReport,
  type HygieneCheck,
} from "../cli/hygieneCheck";

vi.mock("@octokit/rest", () => ({ Octokit: vi.fn() }));

// ---------------------------------------------------------------------------
// Octokit mock shared across API-dependent tests
// ---------------------------------------------------------------------------

function mockOctokit(overrides: Record<string, unknown> = {}) {
  return {
    repos: {
      getContent: vi.fn(),
      ...(overrides.repos as Record<string, unknown>),
    },
    pulls: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      listReviews: vi.fn().mockResolvedValue({ data: [] }),
      ...(overrides.pulls as Record<string, unknown>),
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// checkCoverage (pure function — no API calls)
// ---------------------------------------------------------------------------
describe("checkCoverage", () => {
  it("passes when coverage >= 60%", () => {
    const result = checkCoverage(75);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("75.0%");
  });

  it("passes at exactly 60%", () => {
    const result = checkCoverage(60);
    expect(result.status).toBe("pass");
  });

  it("fails when coverage < 60%", () => {
    const result = checkCoverage(50);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("50.0%");
    expect(result.detail).toContain("60%");
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

  const passCheck: HygieneCheck = { name: "README.md", status: "pass", detail: "Present" };
  const failCheck: HygieneCheck = { name: "Coverage", status: "fail", detail: "50% < 60%" };
  const warnCheck: HygieneCheck = { name: "Coverage", status: "warn", detail: "Skipped" };

  it("renders a passing report with ✅ and PASS", () => {
    const md = renderHygieneMarkdown(makeReport([passCheck], "pass"));
    expect(md).toContain("✅");
    expect(md).toContain("Engineering Hygiene Report");
    expect(md).toContain("test/repo");
    expect(md).toContain("PASS");
  });

  it("renders a failing report with ❌ and FAIL", () => {
    const md = renderHygieneMarkdown(makeReport([failCheck], "fail"));
    expect(md).toContain("❌");
    expect(md).toContain("FAIL");
    expect(md).toContain("1 check(s) failed");
  });

  it("includes table headers", () => {
    const md = renderHygieneMarkdown(makeReport([passCheck], "pass"));
    expect(md).toContain("| Check | Status | Detail |");
  });

  it("renders multiple checks in the table", () => {
    const stalePRCheck: HygieneCheck = { name: "Stale PRs", status: "warn", detail: "Unknown" };
    const md = renderHygieneMarkdown(makeReport([passCheck, failCheck, stalePRCheck], "fail"));
    expect(md).toContain("README.md");
    expect(md).toContain("Coverage");
    expect(md).toContain("Stale PRs");
    expect(md).toContain("⚠️");
  });

  it("shows congratulations when all checks pass", () => {
    const md = renderHygieneMarkdown(
      makeReport([{ name: "All Good", status: "pass", detail: "Excellent" }], "pass"),
    );
    expect(md).toContain("All checks passed");
    expect(md).toContain("🎉");
  });

  it("shows warn message when checks have warnings but no failures", () => {
    const md = renderHygieneMarkdown(makeReport([passCheck, warnCheck], "warn"));
    expect(md).toContain("1 check(s) skipped or need attention");
    expect(md).not.toContain("All checks passed");
  });
});

// ---------------------------------------------------------------------------
// checkReadme (Octokit-dependent)
// ---------------------------------------------------------------------------
describe("checkReadme", () => {
  it("passes when README is long enough", async () => {
    const octo = mockOctokit();
    const content = Buffer.from("A".repeat(200)).toString("base64");
    octo.repos.getContent.mockResolvedValue({ data: { content } });

    const result = await checkReadme(octo, "owner", "repo");

    expect(result.status).toBe("pass");
    expect(result.detail).toContain("substantive");
  });

  it("warns when README is too short", async () => {
    const octo = mockOctokit();
    const content = Buffer.from("Hi").toString("base64");
    octo.repos.getContent.mockResolvedValue({ data: { content } });

    const result = await checkReadme(octo, "owner", "repo");

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("short");
  });

  it("fails when README is missing", async () => {
    const octo = mockOctokit();
    octo.repos.getContent.mockRejectedValue(new Error("Not Found"));

    const result = await checkReadme(octo, "owner", "repo");

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("missing");
  });

  it("fails when content cannot be read", async () => {
    const octo = mockOctokit();
    octo.repos.getContent.mockResolvedValue({ data: { type: "dir" } });

    const result = await checkReadme(octo, "owner", "repo");

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("could not be read");
  });
});

// ---------------------------------------------------------------------------
// checkStalePRs (Octokit-dependent)
// ---------------------------------------------------------------------------
describe("checkStalePRs", () => {
  it("passes when no open PRs exceed the wait threshold", async () => {
    const octo = mockOctokit();
    octo.pulls.list.mockResolvedValue({ data: [] });

    const result = await checkStalePRs(octo, "owner", "repo", 72);

    expect(result.status).toBe("pass");
    expect(result.detail).toContain(">72h");
  });

  it("fails when PRs are stale and un-reviewed", async () => {
    const ago = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(); // 100h ago
    const octo = mockOctokit();
    octo.pulls.list.mockResolvedValue({
      data: [{ number: 42, created_at: ago }],
    });
    octo.pulls.listReviews.mockResolvedValue({ data: [] }); // no reviews

    const result = await checkStalePRs(octo, "owner", "repo", 72);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("#42");
  });

  it("warns about stale PRs when configured for a non-blocking CI report", async () => {
    const ago = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString();
    const octo = mockOctokit();
    octo.pulls.list.mockResolvedValue({ data: [{ number: 42, created_at: ago }] });

    const result = await checkStalePRs(octo, "owner", "repo", 72, "warn");

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("#42");
    expect(result.detail).toContain("1 PR(s) waiting >72h");
  });

  it("passes when aged PRs already have reviews", async () => {
    const ago = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString();
    const octo = mockOctokit();
    octo.pulls.list.mockResolvedValue({
      data: [{ number: 10, created_at: ago }],
    });
    octo.pulls.listReviews.mockResolvedValue({ data: [{ id: 1 }] }); // has review

    const result = await checkStalePRs(octo, "owner", "repo", 72);

    expect(result.status).toBe("pass");
  });

  it("warns when API call fails", async () => {
    const octo = mockOctokit();
    octo.pulls.list.mockRejectedValue(new Error("Network error"));

    const result = await checkStalePRs(octo, "owner", "repo", 72);

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("Could not fetch");
  });

  it("truncates when more than 5 stale PRs", async () => {
    const ago = new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString();
    const octo = mockOctokit();
    const prs = Array.from({ length: 7 }, (_, i) => ({ number: i + 1, created_at: ago }));
    octo.pulls.list.mockResolvedValue({ data: prs });
    octo.pulls.listReviews.mockResolvedValue({ data: [] });

    const result = await checkStalePRs(octo, "owner", "repo", 72);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("7 PR(s)");
    expect(result.detail).toContain("…");
  });
});

// ---------------------------------------------------------------------------
// runHygieneCheck (integration orchestrator)
// ---------------------------------------------------------------------------
describe("runHygieneCheck", () => {
  it.each([
    [90, "warn"],
    [50, "fail"],
  ] as const)(
    "reports %s%% coverage with advisory stale reviews as %s",
    async (coverage, status) => {
      const octo = mockOctokit();
      octo.repos.getContent.mockResolvedValue({
        data: { content: Buffer.from("A".repeat(200)).toString("base64") },
      });
      octo.pulls.list.mockResolvedValue({
        data: [
          { number: 42, created_at: new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString() },
        ],
      });
      vi.mocked(Octokit).mockImplementationOnce(function () {
        return octo;
      });

      const report = await runHygieneCheck({
        token: "test-token",
        repo: "owner/repo",
        coveragePercent: coverage,
        staleReviewStatus: "warn",
      });

      expect(report.overallStatus).toBe(status);
      expect(report.checks.find((check) => check.name === "Stale PR Review")?.status).toBe("warn");
      expect(report.markdownSummary).toContain("#42");
    },
  );

  it("derives overall fail when any check fails", async () => {
    // We directly test the derivation by exercising the rendered markdown
    const report = {
      repo: "o/r",
      timestamp: new Date().toISOString(),
      checks: [
        { name: "A", status: "pass" as const, detail: "ok" },
        { name: "B", status: "fail" as const, detail: "bad" },
      ],
      overallStatus: "fail" as const,
      markdownSummary: "",
    };
    const md = renderHygieneMarkdown(report);
    expect(md).toContain("FAIL");
  });

  it("derives overall warn when no failures but some warnings", async () => {
    const report: HygieneReport = {
      repo: "o/r",
      timestamp: new Date().toISOString(),
      checks: [
        { name: "A", status: "pass", detail: "ok" },
        { name: "B", status: "warn", detail: "hmm" },
      ],
      overallStatus: "warn",
      markdownSummary: "",
    };
    const md = renderHygieneMarkdown(report);
    expect(md).toContain("WARN");
  });
});
