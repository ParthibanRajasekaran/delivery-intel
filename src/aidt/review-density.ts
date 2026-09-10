// ============================================================================
// AIDT — Review Density
// ============================================================================
// Computes review time per line of code (seconds/loc) for a single PR.
//
// Per-file timestamps are not reliably available from standard GitHub REST
// APIs, so this module always uses the aggregate fallback:
//   review_time = last_review_submitted_at - pr_created_at
//   review_time_per_loc = review_time / total_lines_changed
// ============================================================================

import type { Octokit } from "@octokit/rest";
import type { ReviewDensity, PrReview, PrFile } from "./types.js";

export async function computeReviewDensity(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  prCreatedAt: string,
): Promise<ReviewDensity> {
  const [reviewsRes, filesRes] = await Promise.all([
    octokit.pulls.listReviews({ owner, repo, pull_number: prNumber, per_page: 100 }),
    octokit.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 }),
  ]);

  const reviews = reviewsRes.data as PrReview[];
  const files = filesRes.data as PrFile[];

  const totalLinesChanged = files.reduce((s, f) => s + f.changes, 0);

  const submittedReviews = reviews.filter(
    (r) => r.submitted_at && r.state !== "PENDING" && r.state !== "DISMISSED",
  );

  let totalReviewSeconds = 0;

  if (submittedReviews.length > 0) {
    const prCreated = new Date(prCreatedAt).getTime();
    const lastSubmitted = Math.max(
      ...submittedReviews.map((r) => new Date(r.submitted_at!).getTime()),
    );
    totalReviewSeconds = Math.max(0, (lastSubmitted - prCreated) / 1000);
  }

  const reviewTimePerLoc = totalLinesChanged > 0 ? totalReviewSeconds / totalLinesChanged : 0;

  return {
    totalReviewSeconds,
    totalLinesChanged,
    reviewTimePerLoc,
    source: "aggregate-fallback",
  };
}
