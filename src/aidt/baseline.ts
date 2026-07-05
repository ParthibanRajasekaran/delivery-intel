// ============================================================================
// AIDT — Baseline Density
// ============================================================================
// Rolling 90-day median of review_time_seconds / lines_changed, computed
// from PRs with zero AI authorship signals. Falls back to 6.0 if fewer
// than 10 qualifying PRs exist in the window.
// ============================================================================

import type { Octokit } from "@octokit/rest";
import { BASELINE_FALLBACK } from "./scorer.js";
import { computeDescriptionMatch, computeDiffEntropyScore } from "./authorship.js";
import type { BasePr, PrFile } from "./types.js";

const BASELINE_WINDOW_DAYS = 90;
const MIN_QUALIFYING_PRS = 10;
/** Diff entropy score above this threshold is treated as likely-AI; excluded from baseline. */
const ENTROPY_AI_THRESHOLD = 0.8;

function median(values: number[]): number {
  if (values.length === 0) {
    return BASELINE_FALLBACK;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function hasAiDescriptionSignal(pr: BasePr): boolean {
  return computeDescriptionMatch(pr.title, pr.body ?? "");
}

export async function computeBaselineDensity(
  octokit: Octokit,
  owner: string,
  repo: string,
  excludePrNumber: number,
): Promise<{ density: number; source: "computed" | "fallback" }> {
  const since = new Date();
  since.setDate(since.getDate() - BASELINE_WINDOW_DAYS);

  // Fetch recent merged PRs — limit to 50 to stay within rate limits
  const { data: prs } = await octokit.pulls.list({
    owner,
    repo,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: 50,
  });

  const candidates = (prs as BasePr[]).filter(
    (pr) =>
      pr.number !== excludePrNumber &&
      pr.merged_at !== null &&
      new Date(pr.merged_at) >= since &&
      !hasAiDescriptionSignal(pr),
  );

  if (candidates.length < MIN_QUALIFYING_PRS) {
    return { density: BASELINE_FALLBACK, source: "fallback" };
  }

  const densities: number[] = [];

  for (const pr of candidates) {
    try {
      const [reviewsRes, filesRes] = await Promise.all([
        octokit.pulls.listReviews({ owner, repo, pull_number: pr.number, per_page: 100 }),
        octokit.pulls.listFiles({ owner, repo, pull_number: pr.number, per_page: 100 }),
      ]);

      const files = filesRes.data as PrFile[];
      const totalLines = files.reduce((s, f) => s + f.changes, 0);
      if (totalLines === 0) {
        continue;
      }

      // Exclude PRs whose diff entropy suggests AI authorship, even without a description signal
      if (computeDiffEntropyScore(files) >= ENTROPY_AI_THRESHOLD) {
        continue;
      }

      const submittedReviews = reviewsRes.data.filter(
        (r) =>
          r.submitted_at &&
          (r as { state: string }).state !== "PENDING" &&
          (r as { state: string }).state !== "DISMISSED",
      );
      if (submittedReviews.length === 0) {
        continue;
      }

      const prCreated = new Date(pr.created_at).getTime();
      const lastSubmitted = Math.max(
        ...submittedReviews.map((r) => new Date(r.submitted_at!).getTime()),
      );
      const reviewSeconds = Math.max(0, (lastSubmitted - prCreated) / 1000);
      densities.push(reviewSeconds / totalLines);
    } catch {
      // Skip PRs that fail to fetch
    }
  }

  if (densities.length < MIN_QUALIFYING_PRS) {
    return { density: BASELINE_FALLBACK, source: "fallback" };
  }

  return { density: median(densities), source: "computed" };
}
