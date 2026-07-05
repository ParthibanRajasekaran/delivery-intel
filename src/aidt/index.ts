// ============================================================================
// AIDT — Public API
// ============================================================================
// runAidt() orchestrates the full canary trust scoring pipeline for a single PR.
// ============================================================================

import { Octokit } from "@octokit/rest";
import type { AidtInput, AidtResult } from "./types.js";
import {
  computeDescriptionMatch,
  computeDiffEntropyScore,
  fetchCopilotAcceptanceRate,
  computeAiAuthorshipPct,
} from "./authorship.js";
import { computeReviewDensity } from "./review-density.js";
import { computeBaselineDensity } from "./baseline.js";
import {
  computeRiskWeight,
  resolveCanaryDuration,
  resolveRiskTier,
  buildRecommendation,
} from "./scorer.js";
import type { PrFile } from "./types.js";

export type { AidtResult } from "./types.js";

export async function runAidt(input: AidtInput): Promise<AidtResult> {
  const { owner, repo, prNumber, token, copilotOrgToken } = input;
  const octokit = new Octokit(token ? { auth: token } : {});

  // 1. Fetch PR metadata
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });

  // 2. Fetch PR files for diff entropy
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  // 3. Heuristic 1 — description signature
  const descriptionMatch = computeDescriptionMatch(pr.title, pr.body ?? "");

  // 4. Heuristic 2 — diff entropy
  const diffEntropyScore = computeDiffEntropyScore(files as PrFile[]);

  // 5. Heuristic 3 — Copilot metrics (opt-in, graceful fallback)
  let copilotAcceptanceRate: number | null = null;
  if (copilotOrgToken && pr.merged_at) {
    copilotAcceptanceRate = await fetchCopilotAcceptanceRate(owner, pr.merged_at, copilotOrgToken);
  }

  // 6. Combined authorship score
  const aiAuthorshipPct = computeAiAuthorshipPct(
    descriptionMatch,
    diffEntropyScore,
    copilotAcceptanceRate,
  );

  // 7. Review density
  const density = await computeReviewDensity(octokit, owner, repo, prNumber, pr.created_at);

  // 8. Baseline density
  const { density: baselineDensity, source: baselineSource } = await computeBaselineDensity(
    octokit,
    owner,
    repo,
    prNumber,
  );

  // 9. Risk weight and canary duration
  const riskWeight = computeRiskWeight(aiAuthorshipPct, density.reviewTimePerLoc, baselineDensity);
  const canaryDuration = resolveCanaryDuration(riskWeight);
  const riskTier = resolveRiskTier(riskWeight);

  return {
    pr_number: prNumber,
    ai_authorship_pct: Math.round(aiAuthorshipPct * 1000) / 1000,
    review_time_per_loc: Math.round(density.reviewTimePerLoc * 100) / 100,
    baseline_density: Math.round(baselineDensity * 100) / 100,
    risk_weight: riskWeight,
    canary_duration_minutes: canaryDuration,
    risk_tier: riskTier,
    authorship_signals: {
      description_match: descriptionMatch,
      diff_entropy_score: Math.round(diffEntropyScore * 1000) / 1000,
      copilot_acceptance_rate: copilotAcceptanceRate,
    },
    baseline_source: baselineSource,
    recommendation: buildRecommendation(riskTier, canaryDuration),
  };
}
