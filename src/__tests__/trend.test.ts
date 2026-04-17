// ============================================================================
// Trend computation tests
// ============================================================================
// Tests computeTrend() by mocking the shared GitHub fetchers so no network
// calls are made. Exercises delta sign conventions, window splitting, and
// the score computation for each 30-day window.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the shared GitHub module before importing the analyzer
vi.mock("../shared/github.js", () => ({
  createOctokit: vi.fn(() => ({})),
  parseRepoSlug: vi.fn(),
  fetchDeployments: vi.fn(),
  fetchMergedPRs: vi.fn(),
  fetchWorkflowRuns: vi.fn(),
  fetchFileContent: vi.fn(),
}));

import type { Octokit } from "@octokit/rest";
import { computeTrend } from "../cli/analyzer.js";
import * as sharedGithub from "../shared/github.js";

const mocked = vi.mocked;
const MOCK_OCTOKIT = {} as unknown as Octokit;
const REPO = { owner: "test", repo: "repo" };

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

let _nextId = 1;
const nextId = () => _nextId++;

function makeDeploy(daysBack: number) {
  const ts = daysAgo(daysBack);
  return { id: nextId(), created_at: ts, updated_at: ts };
}

function makePR(createdDaysBack: number, mergedDaysBack: number) {
  return {
    number: nextId(),
    created_at: daysAgo(createdDaysBack),
    merged_at: daysAgo(mergedDaysBack),
  };
}

function makeRun(daysBack: number, conclusion: string) {
  return {
    id: nextId(),
    status: "completed",
    conclusion,
    created_at: daysAgo(daysBack),
  };
}

function mockGitHub(opts: {
  deployments?: ReturnType<typeof makeDeploy>[];
  prs?: ReturnType<typeof makePR>[];
  runs?: ReturnType<typeof makeRun>[];
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mocked(sharedGithub.fetchDeployments).mockResolvedValue((opts.deployments ?? []) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mocked(sharedGithub.fetchMergedPRs).mockResolvedValue((opts.prs ?? []) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mocked(sharedGithub.fetchWorkflowRuns).mockResolvedValue((opts.runs ?? []) as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe("computeTrend — structure", () => {
  it("returns a TrendData object with all required fields", async () => {
    mockGitHub({});

    const trend = await computeTrend(MOCK_OCTOKIT, REPO);

    expect(trend).toHaveProperty("windowDays", 30);
    expect(trend).toHaveProperty("current");
    expect(trend).toHaveProperty("prior");
    expect(trend).toHaveProperty("deltas");

    for (const window of [trend.current, trend.prior]) {
      expect(window).toHaveProperty("deploymentsPerWeek");
      expect(window).toHaveProperty("leadTimeHours");
      expect(window).toHaveProperty("changeFailureRate");
      expect(window).toHaveProperty("score");
    }

    expect(trend.deltas).toHaveProperty("deploymentsPerWeek");
    expect(trend.deltas).toHaveProperty("leadTimeHours");
    expect(trend.deltas).toHaveProperty("changeFailureRate");
    expect(trend.deltas).toHaveProperty("score");
  });

  it("returns all zeros when no data is available", async () => {
    mockGitHub({});

    const trend = await computeTrend(MOCK_OCTOKIT, REPO);

    expect(trend.current.deploymentsPerWeek).toBe(0);
    expect(trend.prior.deploymentsPerWeek).toBe(0);
    expect(trend.deltas.deploymentsPerWeek).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Window splitting
// ---------------------------------------------------------------------------

describe("computeTrend — window splitting", () => {
  it("only counts deployments within the current 30-day window", async () => {
    mockGitHub({
      deployments: [
        makeDeploy(5), // current window
        makeDeploy(10), // current window
        makeDeploy(40), // prior window — must NOT appear in current
      ],
    });

    const trend = await computeTrend(MOCK_OCTOKIT, REPO);

    // 2 events in current window / (30/7 weeks) ≈ 0.47/wk
    expect(trend.current.deploymentsPerWeek).toBeGreaterThan(0);
    // prior has 1 event
    expect(trend.prior.deploymentsPerWeek).toBeGreaterThan(0);
    // current should be higher than prior (2 vs 1)
    expect(trend.current.deploymentsPerWeek).toBeGreaterThan(trend.prior.deploymentsPerWeek);
  });

  it("ignores events older than 60 days entirely", async () => {
    mockGitHub({
      deployments: [
        makeDeploy(65), // outside both windows — ignored
        makeDeploy(70),
      ],
    });

    const trend = await computeTrend(MOCK_OCTOKIT, REPO);

    expect(trend.current.deploymentsPerWeek).toBe(0);
    expect(trend.prior.deploymentsPerWeek).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Delta conventions
// ---------------------------------------------------------------------------

describe("computeTrend — delta conventions", () => {
  it("produces positive deploymentsPerWeek delta when current > prior", async () => {
    mockGitHub({
      deployments: [
        makeDeploy(5),
        makeDeploy(8),
        makeDeploy(12), // 3 in current
        makeDeploy(35), // 1 in prior
      ],
    });

    const trend = await computeTrend(MOCK_OCTOKIT, REPO);

    expect(trend.deltas.deploymentsPerWeek).toBeGreaterThan(0);
  });

  it("produces negative changeFailureRate delta when current < prior", async () => {
    mockGitHub({
      runs: [
        // current window: 1 failure out of 10 = 10%
        makeRun(5, "success"),
        makeRun(5, "success"),
        makeRun(5, "success"),
        makeRun(5, "success"),
        makeRun(5, "success"),
        makeRun(5, "success"),
        makeRun(5, "success"),
        makeRun(5, "success"),
        makeRun(5, "success"),
        makeRun(5, "failure"),
        // prior window: 5 failures out of 10 = 50%
        makeRun(35, "success"),
        makeRun(35, "success"),
        makeRun(35, "success"),
        makeRun(35, "success"),
        makeRun(35, "success"),
        makeRun(35, "failure"),
        makeRun(35, "failure"),
        makeRun(35, "failure"),
        makeRun(35, "failure"),
        makeRun(35, "failure"),
      ],
    });

    const trend = await computeTrend(MOCK_OCTOKIT, REPO);

    // Failure rate went down (improving) → negative delta
    expect(trend.deltas.changeFailureRate).toBeLessThan(0);
    expect(trend.current.changeFailureRate).toBeLessThan(trend.prior.changeFailureRate);
  });

  it("deltas are arithmetic differences between current and prior", async () => {
    mockGitHub({
      deployments: [
        makeDeploy(5), // current: 1
        makeDeploy(35), // prior: 1
      ],
    });

    const trend = await computeTrend(MOCK_OCTOKIT, REPO);

    expect(trend.deltas.deploymentsPerWeek).toBeCloseTo(
      trend.current.deploymentsPerWeek - trend.prior.deploymentsPerWeek,
      2,
    );
    expect(trend.deltas.score).toBe(trend.current.score - trend.prior.score);
  });
});

// ---------------------------------------------------------------------------
// Lead time
// ---------------------------------------------------------------------------

describe("computeTrend — lead time", () => {
  it("computes lead time as median hours from PR created to merged", async () => {
    mockGitHub({
      prs: [
        makePR(10, 8), // created 10d ago, merged 8d ago → 2d = 48h (current window)
        makePR(40, 38), // created 40d ago, merged 38d ago → 2d = 48h (prior window)
      ],
    });

    const trend = await computeTrend(MOCK_OCTOKIT, REPO);

    // Both windows should show ~48h lead time
    expect(trend.current.leadTimeHours).toBeGreaterThanOrEqual(47);
    expect(trend.current.leadTimeHours).toBeLessThanOrEqual(49);
    expect(trend.prior.leadTimeHours).toBeGreaterThanOrEqual(47);
    expect(trend.prior.leadTimeHours).toBeLessThanOrEqual(49);
    expect(trend.deltas.leadTimeHours).toBeCloseTo(0, 0);
  });
});
