import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all heavy dependencies so route handlers become pure request→response
// ---------------------------------------------------------------------------

vi.mock("@/lib/github", () => ({
  parseRepoSlug: vi.fn((slug: string) => {
    const [owner, repo] = slug.split("/");
    if (!owner || !repo) {
      throw new Error(`Invalid repo slug: "${slug}"`);
    }
    return { owner, repo };
  }),
  fetchRecentCommits: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/metrics", () => ({
  computeDORAMetrics: vi.fn().mockResolvedValue({
    deploymentFrequency: {
      deploymentsPerWeek: 3,
      rating: "High",
      source: "deployments_api",
    },
    leadTimeForChanges: { medianHours: 12, rating: "Elite" },
    changeFailureRate: {
      percentage: 5,
      failedRuns: 1,
      totalRuns: 20,
      rating: "Elite",
    },
    meanTimeToRestore: { medianHours: null, rating: "N/A" },
  }),
}));

vi.mock("@/lib/vulnerabilities", () => ({
  scanVulnerabilities: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/suggestions", () => ({
  generateSuggestions: vi.fn().mockReturnValue([]),
  computeOverallScore: vi.fn().mockReturnValue(85),
}));

vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "@/app/api/analyze/route";
import { GET } from "@/app/api/health/route";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// /api/health
// ---------------------------------------------------------------------------

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.timestamp).toBeDefined();
    expect(data.env).toHaveProperty("hasGithubToken");
    expect(data.env).toHaveProperty("hasRedis");
  });
});

// ---------------------------------------------------------------------------
// /api/analyze
// ---------------------------------------------------------------------------

describe("POST /api/analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when body has no repo field", async () => {
    const res = await POST(makeRequest({}));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("repo");
  });

  it("returns 400 when repo is not a string", async () => {
    const res = await POST(makeRequest({ repo: 123 }));

    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid repo slug", async () => {
    const res = await POST(makeRequest({ repo: "invalid" }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Invalid");
  });

  it("returns 200 with analysis for a valid repo", async () => {
    const res = await POST(makeRequest({ repo: "owner/repo" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.repo).toEqual({ owner: "owner", repo: "repo" });
    expect(data.doraMetrics).toBeDefined();
    expect(data.overallScore).toBe(85);
    expect(data.suggestions).toEqual([]);
    expect(data.vulnerabilities).toEqual([]);
  });

  it("returns cached result when available", async () => {
    const { cacheGet } = await import("@/lib/cache");
    const cachedResult = {
      repo: { owner: "cached", repo: "repo" },
      fetchedAt: "2026-01-01T00:00:00Z",
      doraMetrics: {},
      vulnerabilities: [],
      suggestions: [],
      overallScore: 90,
    };
    vi.mocked(cacheGet).mockResolvedValueOnce(cachedResult);

    const res = await POST(makeRequest({ repo: "cached/repo" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data._cached).toBe(true);
    expect(data.overallScore).toBe(90);
  });

  it("returns 429 on GitHub rate limit errors", async () => {
    const { computeDORAMetrics } = await import("@/lib/metrics");
    vi.mocked(computeDORAMetrics).mockRejectedValueOnce(new Error("API rate limit exceeded"));

    const res = await POST(makeRequest({ repo: "owner/repo" }));
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data.error).toContain("rate limit");
  });

  it("returns 500 on unexpected errors", async () => {
    const { computeDORAMetrics } = await import("@/lib/metrics");
    vi.mocked(computeDORAMetrics).mockRejectedValueOnce(new Error("Network failure"));

    const res = await POST(makeRequest({ repo: "owner/repo" }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toContain("Network failure");
  });
});
