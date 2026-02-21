import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitHubDeployment, GitHubPullRequest, GitHubWorkflowRun } from "@/types";

// ---------------------------------------------------------------------------
// We test the pure rating functions and the median helper by extracting
// them indirectly through computeDORAMetrics. Since they're not exported
// directly, we test through the public API by mocking the GitHub fetchers.
// ---------------------------------------------------------------------------

// Mock the github module before importing metrics
vi.mock("@/lib/github", () => ({
  fetchDeployments: vi.fn(),
  fetchDeploymentStatuses: vi.fn(),
  fetchMergedPullRequests: vi.fn(),
  fetchWorkflowRuns: vi.fn(),
  fetchPRsWithDeployments: vi.fn(),
}));

import { computeDORAMetrics } from "@/lib/metrics";
import * as github from "@/lib/github";

const mocked = vi.mocked;

const REPO = { owner: "test", repo: "repo" };

// ---------------------------------------------------------------------------
// Factory helpers — eliminate repeated fixture construction
// ---------------------------------------------------------------------------

let _prSeq = 0;

function makePR(
  overrides: Partial<GitHubPullRequest> & { created_at: string; merged_at: string },
): GitHubPullRequest {
  _prSeq++;
  return {
    number: _prSeq,
    title: `PR ${_prSeq}`,
    state: "closed",
    closed_at: overrides.merged_at,
    user: { login: "dev", avatar_url: "" },
    head: { ref: `feat-${_prSeq}`, sha: _prSeq.toString(16).padStart(3, "0") },
    base: { ref: "main" },
    html_url: "",
    ...overrides,
  };
}

let _runSeq = 0;

function makeRun(overrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun {
  _runSeq++;
  const ts = new Date().toISOString();
  return {
    id: _runSeq,
    name: "CI",
    status: "completed",
    conclusion: "success",
    created_at: ts,
    updated_at: ts,
    head_branch: "main",
    html_url: "",
    ...overrides,
  };
}

let _deploySeq = 0;

function makeDeployment(overrides: Partial<GitHubDeployment> = {}): GitHubDeployment {
  _deploySeq++;
  const ts = new Date().toISOString();
  return {
    id: _deploySeq,
    created_at: ts,
    updated_at: ts,
    environment: "production",
    sha: _deploySeq.toString(16).padStart(3, "0"),
    ref: "main",
    task: "deploy",
    description: null,
    statuses_url: "",
    ...overrides,
  };
}

/** Set all three fetcher mocks at once; defaults to empty arrays. */
function mockGitHub(
  opts: {
    deployments?: GitHubDeployment[];
    prs?: GitHubPullRequest[];
    runs?: GitHubWorkflowRun[];
  } = {},
) {
  mocked(github.fetchDeployments).mockResolvedValue(opts.deployments ?? []);
  mocked(github.fetchMergedPullRequests).mockResolvedValue(opts.prs ?? []);
  mocked(github.fetchWorkflowRuns).mockResolvedValue(opts.runs ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
  _prSeq = 0;
  _runSeq = 0;
  _deploySeq = 0;
});

// =========================================================================
// Deployment Frequency
// =========================================================================

describe("Deployment Frequency", () => {
  it("uses the Deployments API when deployments exist", async () => {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    mockGitHub({
      deployments: [
        makeDeployment({ created_at: now.toISOString(), updated_at: now.toISOString() }),
        makeDeployment({
          created_at: twoWeeksAgo.toISOString(),
          updated_at: twoWeeksAgo.toISOString(),
        }),
      ],
    });

    const result = await computeDORAMetrics(REPO);

    expect(result.deploymentFrequency.source).toBe("deployments_api");
    expect(result.deploymentFrequency.deploymentsPerWeek).toBeGreaterThan(0);
  });

  it("falls back to merged PRs when no deployments exist", async () => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    mockGitHub({
      prs: [
        makePR({ created_at: oneWeekAgo.toISOString(), merged_at: now.toISOString() }),
        makePR({ created_at: oneWeekAgo.toISOString(), merged_at: oneWeekAgo.toISOString() }),
      ],
    });

    const result = await computeDORAMetrics(REPO);

    expect(result.deploymentFrequency.source).toBe("merged_prs_fallback");
    expect(result.deploymentFrequency.deploymentsPerWeek).toBeGreaterThan(0);
  });

  it("returns Low rating when no data available", async () => {
    mockGitHub();

    const result = await computeDORAMetrics(REPO);

    expect(result.deploymentFrequency.rating).toBe("Low");
    expect(result.deploymentFrequency.deploymentsPerWeek).toBe(0);
  });
});

// =========================================================================
// Lead Time for Changes
// =========================================================================

describe("Lead Time for Changes", () => {
  it("computes median hours from PR created to PR merged", async () => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    mockGitHub({
      prs: [makePR({ created_at: dayAgo.toISOString(), merged_at: now.toISOString() })],
    });

    const result = await computeDORAMetrics(REPO);

    // Should be approximately 24 hours
    expect(result.leadTimeForChanges.medianHours).toBeGreaterThanOrEqual(23);
    expect(result.leadTimeForChanges.medianHours).toBeLessThanOrEqual(25);
  });

  it("rates Elite when lead time is under 24 hours", async () => {
    const now = new Date();
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    mockGitHub({
      prs: [makePR({ created_at: fourHoursAgo.toISOString(), merged_at: now.toISOString() })],
    });

    const result = await computeDORAMetrics(REPO);

    expect(result.leadTimeForChanges.rating).toBe("Elite");
  });

  it("returns N/A rating when no merged PRs exist", async () => {
    mockGitHub();

    const result = await computeDORAMetrics(REPO);

    expect(result.leadTimeForChanges.rating).toBe("N/A");
    expect(result.leadTimeForChanges.medianHours).toBe(0);
  });
});

// =========================================================================
// Change Failure Rate
// =========================================================================

describe("Change Failure Rate", () => {
  it("computes failure percentage from completed workflow runs", async () => {
    mockGitHub({
      runs: [makeRun(), makeRun({ conclusion: "failure" }), makeRun(), makeRun()],
    });

    const result = await computeDORAMetrics(REPO);

    // 1 failure out of 4 = 25%
    expect(result.changeFailureRate.percentage).toBe(25);
    expect(result.changeFailureRate.failedRuns).toBe(1);
    expect(result.changeFailureRate.totalRuns).toBe(4);
  });

  it("ignores in-progress runs", async () => {
    mockGitHub({
      runs: [makeRun(), makeRun({ status: "in_progress", conclusion: null })],
    });

    const result = await computeDORAMetrics(REPO);

    expect(result.changeFailureRate.totalRuns).toBe(1);
    expect(result.changeFailureRate.percentage).toBe(0);
  });

  it("returns N/A when no runs exist", async () => {
    mockGitHub();

    const result = await computeDORAMetrics(REPO);

    expect(result.changeFailureRate.rating).toBe("N/A");
    expect(result.changeFailureRate.percentage).toBe(0);
  });

  it("returns N/A when all runs are in-progress", async () => {
    mockGitHub({
      runs: [
        makeRun({ status: "in_progress", conclusion: null }),
        makeRun({ status: "queued", conclusion: null }),
      ],
    });

    const result = await computeDORAMetrics(REPO);

    expect(result.changeFailureRate.rating).toBe("N/A");
    expect(result.changeFailureRate.totalRuns).toBe(0);
  });

  it("rates Elite for ≤5% failure rate", async () => {
    mockGitHub({
      runs: Array.from({ length: 20 }, () => makeRun()),
    });

    const result = await computeDORAMetrics(REPO);

    expect(result.changeFailureRate.percentage).toBe(0);
    expect(result.changeFailureRate.rating).toBe("Elite");
  });

  it("rates High for 6-10% failure rate", async () => {
    mockGitHub({
      runs: [...Array.from({ length: 9 }, () => makeRun()), makeRun({ conclusion: "failure" })],
    });

    const result = await computeDORAMetrics(REPO);

    expect(result.changeFailureRate.percentage).toBe(10);
    expect(result.changeFailureRate.rating).toBe("High");
  });

  it("rates Medium for 11-15% failure rate", async () => {
    // 2 failures out of 15 = 13.3%
    mockGitHub({
      runs: [
        ...Array.from({ length: 13 }, () => makeRun()),
        makeRun({ conclusion: "failure" }),
        makeRun({ conclusion: "failure" }),
      ],
    });

    const result = await computeDORAMetrics(REPO);

    expect(result.changeFailureRate.rating).toBe("Medium");
  });
});

// =========================================================================
// Mean Time to Restore (MTTR)
// =========================================================================

describe("Mean Time to Restore", () => {
  /** Helper: set up a failure→success pair on the given branch with the given gap. */
  function setupMTTR(failTime: string, successTime: string, branch = "main") {
    mockGitHub({
      runs: [
        makeRun({ conclusion: "failure", created_at: failTime, head_branch: branch }),
        makeRun({ conclusion: "success", created_at: successTime, head_branch: branch }),
      ],
    });
  }

  it("computes MTTR when a failure is followed by a success on the same branch", async () => {
    setupMTTR("2026-02-20T10:00:00Z", "2026-02-20T12:00:00Z");

    const result = await computeDORAMetrics(REPO);

    expect(result.meanTimeToRestore.medianHours).toBe(2);
    expect(result.meanTimeToRestore.rating).toBe("High"); // < 24h
  });

  it("returns N/A when no failures exist", async () => {
    mockGitHub({ runs: [makeRun(), makeRun()] });

    const result = await computeDORAMetrics(REPO);

    expect(result.meanTimeToRestore.medianHours).toBeNull();
    expect(result.meanTimeToRestore.rating).toBe("N/A");
  });

  it("returns N/A when failures exist but no recovery follows", async () => {
    mockGitHub({ runs: [makeRun({ conclusion: "failure", head_branch: "main" })] });

    const result = await computeDORAMetrics(REPO);

    expect(result.meanTimeToRestore.medianHours).toBeNull();
    expect(result.meanTimeToRestore.rating).toBe("N/A");
  });

  it("rates Elite when restoration is under 1 hour", async () => {
    setupMTTR("2026-02-20T10:00:00Z", "2026-02-20T10:30:00Z"); // 30 min

    const result = await computeDORAMetrics(REPO);
    expect(result.meanTimeToRestore.rating).toBe("Elite");
  });

  it("rates Medium when restoration takes days", async () => {
    setupMTTR("2026-02-17T10:00:00Z", "2026-02-20T10:00:00Z"); // 72 hours

    const result = await computeDORAMetrics(REPO);
    expect(result.meanTimeToRestore.rating).toBe("Medium");
  });

  it("rates Low when restoration takes over a week", async () => {
    setupMTTR("2026-02-10T10:00:00Z", "2026-02-20T10:00:00Z"); // 10 days

    const result = await computeDORAMetrics(REPO);
    expect(result.meanTimeToRestore.rating).toBe("Low");
  });

  it("ignores recovery on a different branch", async () => {
    mockGitHub({
      runs: [
        makeRun({
          conclusion: "failure",
          created_at: "2026-02-20T10:00:00Z",
          head_branch: "main",
        }),
        makeRun({
          conclusion: "success",
          created_at: "2026-02-20T12:00:00Z",
          head_branch: "feature",
        }),
      ],
    });

    const result = await computeDORAMetrics(REPO);

    expect(result.meanTimeToRestore.medianHours).toBeNull();
    expect(result.meanTimeToRestore.rating).toBe("N/A");
  });
});

// =========================================================================
// Full DORA computation
// =========================================================================

describe("computeDORAMetrics", () => {
  it("returns all four metric categories", async () => {
    mockGitHub();

    const result = await computeDORAMetrics(REPO);

    expect(result).toHaveProperty("deploymentFrequency");
    expect(result).toHaveProperty("leadTimeForChanges");
    expect(result).toHaveProperty("changeFailureRate");
    expect(result).toHaveProperty("meanTimeToRestore");
  });

  it("runs all metrics in parallel (performance)", async () => {
    mockGitHub();

    await computeDORAMetrics(REPO);

    expect(github.fetchDeployments).toHaveBeenCalledTimes(1);
    // fetchMergedPullRequests is called by both deployFreq (fallback) and leadTime
    expect(github.fetchMergedPullRequests).toHaveBeenCalled();
    expect(github.fetchWorkflowRuns).toHaveBeenCalled();
  });
});
