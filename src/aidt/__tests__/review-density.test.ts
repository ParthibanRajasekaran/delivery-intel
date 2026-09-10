import { describe, it, expect, vi } from "vitest";
import { computeReviewDensity } from "../review-density";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReview(state: string, submittedAt: string | null) {
  return { state, submitted_at: submittedAt };
}

function makeFile(changes: number) {
  return { filename: "src/file.ts", additions: changes, deletions: 0, changes };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeReviewDensity", () => {
  it("computes review time per loc from a single approved review", async () => {
    const prCreatedAt = "2026-01-01T10:00:00Z";
    // Review submitted 1 hour after PR created → 3600s, 100 lines → 36 s/line
    const reviewedAt = "2026-01-01T11:00:00Z";

    const mockOctokit = {
      pulls: {
        listReviews: vi.fn().mockResolvedValue({
          data: [makeReview("APPROVED", reviewedAt)],
        }),
        listFiles: vi.fn().mockResolvedValue({
          data: [makeFile(100)],
        }),
      },
    };

    const result = await computeReviewDensity(
      mockOctokit as never,
      "owner",
      "repo",
      42,
      prCreatedAt,
    );

    expect(result.totalReviewSeconds).toBeCloseTo(3600, 0);
    expect(result.totalLinesChanged).toBe(100);
    expect(result.reviewTimePerLoc).toBeCloseTo(36, 0);
    expect(result.source).toBe("aggregate-fallback");
  });

  it("uses the latest review submission timestamp when multiple reviews exist", async () => {
    const prCreatedAt = "2026-01-01T10:00:00Z";

    const mockOctokit = {
      pulls: {
        listReviews: vi.fn().mockResolvedValue({
          data: [
            makeReview("CHANGES_REQUESTED", "2026-01-01T10:30:00Z"),
            makeReview("APPROVED", "2026-01-01T12:00:00Z"), // 2h after created → 7200s
          ],
        }),
        listFiles: vi.fn().mockResolvedValue({ data: [makeFile(50)] }),
      },
    };

    const result = await computeReviewDensity(
      mockOctokit as never,
      "owner",
      "repo",
      42,
      prCreatedAt,
    );

    expect(result.totalReviewSeconds).toBeCloseTo(7200, 0);
    expect(result.reviewTimePerLoc).toBeCloseTo(144, 0);
  });

  it("returns zero review time when no reviews exist", async () => {
    const mockOctokit = {
      pulls: {
        listReviews: vi.fn().mockResolvedValue({ data: [] }),
        listFiles: vi.fn().mockResolvedValue({ data: [makeFile(80)] }),
      },
    };

    const result = await computeReviewDensity(
      mockOctokit as never,
      "owner",
      "repo",
      42,
      "2026-01-01T10:00:00Z",
    );

    expect(result.totalReviewSeconds).toBe(0);
    expect(result.reviewTimePerLoc).toBe(0);
  });

  it("returns zero review_time_per_loc when total lines changed is zero", async () => {
    const mockOctokit = {
      pulls: {
        listReviews: vi.fn().mockResolvedValue({
          data: [makeReview("APPROVED", "2026-01-01T11:00:00Z")],
        }),
        listFiles: vi.fn().mockResolvedValue({ data: [makeFile(0)] }),
      },
    };

    const result = await computeReviewDensity(
      mockOctokit as never,
      "owner",
      "repo",
      42,
      "2026-01-01T10:00:00Z",
    );

    expect(result.reviewTimePerLoc).toBe(0);
  });

  it("excludes PENDING and DISMISSED reviews from time computation", async () => {
    const prCreatedAt = "2026-01-01T10:00:00Z";

    const mockOctokit = {
      pulls: {
        listReviews: vi.fn().mockResolvedValue({
          data: [
            makeReview("PENDING", "2026-01-01T10:10:00Z"), // should be ignored
            makeReview("DISMISSED", "2026-01-01T10:20:00Z"), // should be ignored
            makeReview("APPROVED", "2026-01-01T11:00:00Z"), // 3600s
          ],
        }),
        listFiles: vi.fn().mockResolvedValue({ data: [makeFile(100)] }),
      },
    };

    const result = await computeReviewDensity(
      mockOctokit as never,
      "owner",
      "repo",
      42,
      prCreatedAt,
    );

    expect(result.totalReviewSeconds).toBeCloseTo(3600, 0);
  });

  it("sums lines changed across multiple files", async () => {
    const mockOctokit = {
      pulls: {
        listReviews: vi.fn().mockResolvedValue({
          data: [makeReview("APPROVED", "2026-01-01T11:00:00Z")],
        }),
        listFiles: vi.fn().mockResolvedValue({
          data: [makeFile(40), makeFile(60)], // 100 total
        }),
      },
    };

    const result = await computeReviewDensity(
      mockOctokit as never,
      "owner",
      "repo",
      42,
      "2026-01-01T10:00:00Z",
    );

    expect(result.totalLinesChanged).toBe(100);
  });
});
