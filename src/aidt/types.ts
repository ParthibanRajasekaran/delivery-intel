// ============================================================================
// AIDT — AI-Integrated Delivery Telemetry · Type Definitions
// ============================================================================

export interface AidtInput {
  owner: string;
  repo: string;
  prNumber: number;
  token?: string;
  /** GitHub org token scoped to read Copilot metrics. Optional — see Heuristic 3. */
  copilotOrgToken?: string;
}

export interface FileAuthorship {
  filename: string;
  linesChanged: number;
  diffEntropyScore: number;
}

export interface ReviewDensity {
  totalReviewSeconds: number;
  totalLinesChanged: number;
  reviewTimePerLoc: number;
  source: "per-file" | "aggregate-fallback";
}

export interface AidtResult {
  pr_number: number;
  ai_authorship_pct: number;
  review_time_per_loc: number;
  baseline_density: number;
  risk_weight: number;
  canary_duration_minutes: number;
  risk_tier: "low" | "medium" | "high";
  authorship_signals: {
    description_match: boolean;
    diff_entropy_score: number;
    copilot_acceptance_rate: number | null;
  };
  baseline_source: "computed" | "fallback";
  recommendation: string;
}

/** Minimal PR file shape from the GitHub pulls.listFiles response. */
export interface PrFile {
  filename: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

/** Minimal PR review shape from the GitHub pulls.listReviews response. */
export interface PrReview {
  submitted_at: string | null | undefined;
  state: string;
}

/** Minimal merged PR shape used for baseline computation. */
export interface BasePr {
  number: number;
  title: string;
  body: string | null | undefined;
  created_at: string;
  merged_at: string | null;
}
