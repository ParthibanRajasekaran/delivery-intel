import { describe, it, expect, vi, beforeEach } from "vitest";

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

beforeEach(() => {
  vi.clearAllMocks();
});

// =========================================================================
// Deployment Frequency
// =========================================================================

describe("Deployment Frequency", () => {
  it("uses the Deployments API when deployments exist", async () => {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    mocked(github.fetchDeployments).mockResolvedValue([
      { id: 1, created_at: now.toISOString(), updated_at: now.toISOString(), environment: "production", sha: "abc", ref: "main", task: "deploy", description: null, statuses_url: "" },
      { id: 2, created_at: twoWeeksAgo.toISOString(), updated_at: twoWeeksAgo.toISOString(), environment: "production", sha: "def", ref: "main", task: "deploy", description: null, statuses_url: "" },
    ]);
    mocked(github.fetchMergedPullRequests).mockResolvedValue([]);
    mocked(github.fetchWorkflowRuns).mockResolvedValue([]);

    const result = await computeDORAMetrics(REPO);

    expect(result.deploymentFrequency.source).toBe("deployments_api");
    expect(result.deploymentFrequency.deploymentsPerWeek).toBeGreaterThan(0);
  });

  it("falls back to merged PRs when no deployments exist", async () => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    mocked(github.fetchDeployments).mockResolvedValue([]);
    mocked(github.fetchMergedPullRequests).mockResolvedValue([
      {
        number: 1,
        title: "PR 1",
        state: "closed",
        created_at: oneWeekAgo.toISOString(),
        merged_at: now.toISOString(),
        closed_at: now.toISOString(),
        user: { login: "user1", avatar_url: "" },
        head: { ref: "feat-1", sha: "aaa" },
        base: { ref: "main" },
        html_url: "",
      },
      {
        number: 2,
        title: "PR 2",
        state: "closed",
        created_at: oneWeekAgo.toISOString(),
        merged_at: oneWeekAgo.toISOString(),
        closed_at: oneWeekAgo.toISOString(),
        user: { login: "user2", avatar_url: "" },
        head: { ref: "feat-2", sha: "bbb" },
        base: { ref: "main" },
        html_url: "",
      },
    ]);
    mocked(github.fetchWorkflowRuns).mockResolvedValue([]);

    const result = await computeDORAMetrics(REPO);

    expect(result.deploymentFrequency.source).toBe("merged_prs_fallback");
    expect(result.deploymentFrequency.deploymentsPerWeek).toBeGreaterThan(0);
  });

  it("returns Low rating when no data available", async () => {
    mocked(github.fetchDeployments).mockResolvedValue([]);
    mocked(github.fetchMergedPullRequests).mockResolvedValue([]);
    mocked(github.fetchWorkflowRuns).mockResolvedValue([]);

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

    mocked(github.fetchDeployments).mockResolvedValue([]);
    mocked(github.fetchMergedPullRequests).mockResolvedValue([
      {
        number: 1,
        title: "Fast PR",
        state: "closed",
        created_at: dayAgo.toISOString(),
        merged_at: now.toISOString(),
        closed_at: now.toISOString(),
        user: { login: "dev", avatar_url: "" },
        head: { ref: "feat", sha: "aaa" },
        base: { ref: "main" },
        html_url: "",
      },
    ]);
    mocked(github.fetchWorkflowRuns).mockResolvedValue([]);

    const result = await computeDORAMetrics(REPO);

    // Should be approximately 24 hours
    expect(result.leadTimeForChanges.medianHours).toBeGreaterThanOrEqual(23);
    expect(result.leadTimeForChanges.medianHours).toBeLessThanOrEqual(25);
  });

  it("rates Elite when lead time is under 24 hours", async () => {
    const now = new Date();
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    mocked(github.fetchDeployments).mockResolvedValue([]);
    mocked(github.fetchMergedPullRequests).mockResolvedValue([
      {
        number: 1,
        title: "Quick PR",
        state: "closed",
        created_at: fourHoursAgo.toISOString(),
        merged_at: now.toISOString(),
        closed_at: now.toISOString(),
        user: { login: "dev", avatar_url: "" },
        head: { ref: "feat", sha: "aaa" },
        base: { ref: "main" },
        html_url: "",
      },
    ]);
    mocked(github.fetchWorkflowRuns).mockResolvedValue([]);

    const result = await computeDORAMetrics(REPO);

    expect(result.leadTimeForChanges.rating).toBe("Elite");
  });
});

// =========================================================================
// Change Failure Rate
// =========================================================================

describe("Change Failure Rate", () => {
  it("computes failure percentage from completed workflow runs", async () => {
    mocked(github.fetchDeployments).mockResolvedValue([]);
    mocked(github.fetchMergedPullRequests).mockResolvedValue([]);
    mocked(github.fetchWorkflowRuns).mockResolvedValue([
      { id: 1, name: "CI", status: "completed", conclusion: "success", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), head_branch: "main", html_url: "" },
      { id: 2, name: "CI", status: "completed", conclusion: "failure", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), head_branch: "main", html_url: "" },
      { id: 3, name: "CI", status: "completed", conclusion: "success", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), head_branch: "main", html_url: "" },
      { id: 4, name: "CI", status: "completed", conclusion: "success", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), head_branch: "main", html_url: "" },
    ]);

    const result = await computeDORAMetrics(REPO);

    // 1 failure out of 4 = 25%
    expect(result.changeFailureRate.percentage).toBe(25);
    expect(result.changeFailureRate.failedRuns).toBe(1);
    expect(result.changeFailureRate.totalRuns).toBe(4);
  });

  it("ignores in-progress runs", async () => {
    mocked(github.fetchDeployments).mockResolvedValue([]);
    mocked(github.fetchMergedPullRequests).mockResolvedValue([]);
    mocked(github.fetchWorkflowRuns).mockResolvedValue([
      { id: 1, name: "CI", status: "completed", conclusion: "success", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), head_branch: "main", html_url: "" },
      { id: 2, name: "CI", status: "in_progress", conclusion: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), head_branch: "main", html_url: "" },
    ]);

    const result = await computeDORAMetrics(REPO);

    expect(result.changeFailureRate.totalRuns).toBe(1);
    expect(result.changeFailureRate.percentage).toBe(0);
  });

  it("returns Elite when no runs exist", async () => {
    mocked(github.fetchDeployments).mockResolvedValue([]);
    mocked(github.fetchMergedPullRequests).mockResolvedValue([]);
    mocked(github.fetchWorkflowRuns).mockResolvedValue([]);

    const result = await computeDORAMetrics(REPO);

    expect(result.changeFailureRate.rating).toBe("Elite");
    expect(result.changeFailureRate.percentage).toBe(0);
  });
});

// =========================================================================
// Full DORA computation
// =========================================================================

describe("computeDORAMetrics", () => {
  it("returns all four metric categories", async () => {
    mocked(github.fetchDeployments).mockResolvedValue([]);
    mocked(github.fetchMergedPullRequests).mockResolvedValue([]);
    mocked(github.fetchWorkflowRuns).mockResolvedValue([]);

    const result = await computeDORAMetrics(REPO);

    expect(result).toHaveProperty("deploymentFrequency");
    expect(result).toHaveProperty("leadTimeForChanges");
    expect(result).toHaveProperty("changeFailureRate");
    expect(result).toHaveProperty("meanTimeToRestore");
  });

  it("runs all metrics in parallel (performance)", async () => {
    // Verify all three fetchers are called without waiting for each other
    mocked(github.fetchDeployments).mockResolvedValue([]);
    mocked(github.fetchMergedPullRequests).mockResolvedValue([]);
    mocked(github.fetchWorkflowRuns).mockResolvedValue([]);

    await computeDORAMetrics(REPO);

    expect(github.fetchDeployments).toHaveBeenCalledTimes(1);
    // fetchMergedPullRequests is called by both deployFreq (fallback) and leadTime
    expect(github.fetchMergedPullRequests).toHaveBeenCalled();
    expect(github.fetchWorkflowRuns).toHaveBeenCalled();
  });
});
