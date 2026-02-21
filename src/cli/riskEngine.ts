// ============================================================================
// Delivery Intel — Delivery Risk Engine
// ============================================================================
// Correlates Git metadata (PR cycle times, commit frequency, failure rate)
// to compute a Burnout Risk Score for teams and repos.
//
// Formula:
//   Risk = (ΔCycleTime × 0.6) + (ΔFailureRate × 0.4)
//   If sentiment multiplier is provided, negative sentiment weighs at 0.5x.
//
// Output: a 0-100 risk score with a qualitative level and breakdown.
// ============================================================================

import type { DORAMetrics } from "./analyzer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export interface RiskBreakdown {
  /** Normalized delta of cycle time vs. elite benchmark (0-1 scale) */
  cycleTimeDelta: number;
  /** Normalized delta of failure rate vs. elite benchmark (0-1 scale) */
  failureRateDelta: number;
  /** Optional sentiment multiplier (defaults to 1.0 — no effect) */
  sentimentMultiplier: number;
  /** Final weighted risk score 0-100 */
  score: number;
  /** Qualitative risk level */
  level: RiskLevel;
  /** Human-readable summary */
  summary: string;
}

export interface RiskInput {
  doraMetrics: DORAMetrics;
  /** Optional negative sentiment ratio (0-1). 1 = all negative. */
  sentimentNegativeRatio?: number;
}

// ---------------------------------------------------------------------------
// Benchmarks (DORA State of DevOps 2024/2025)
// ---------------------------------------------------------------------------

/** Elite lead time benchmark in hours (<24h = Elite) */
const ELITE_LEAD_TIME_HOURS = 24;

/** Elite change failure rate benchmark (<=5% = Elite) */
const ELITE_FAILURE_RATE_PCT = 5;

/** Maximum lead time used for normalization (30 days = 720h) */
const MAX_LEAD_TIME_HOURS = 720;

/** Maximum failure rate used for normalization (100% cap) */
const MAX_FAILURE_RATE_PCT = 100;

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

const CYCLE_TIME_WEIGHT = 0.6;
const FAILURE_RATE_WEIGHT = 0.4;
const SENTIMENT_NEGATIVE_MULTIPLIER = 0.5;

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Normalize a metric delta to a 0-1 scale.
 * 0 = at or better than elite benchmark (no risk contribution)
 * 1 = at or worse than the max cap (full risk contribution)
 */
export function normalizeDelta(actual: number, eliteBenchmark: number, maxCap: number): number {
  if (actual <= eliteBenchmark) {
    return 0;
  }
  const delta = (actual - eliteBenchmark) / (maxCap - eliteBenchmark);
  return Math.min(Math.max(delta, 0), 1);
}

/**
 * Classify a 0-100 risk score into a qualitative level.
 */
export function classifyRiskLevel(score: number): RiskLevel {
  if (score >= 75) {
    return "critical";
  }
  if (score >= 50) {
    return "high";
  }
  if (score >= 25) {
    return "moderate";
  }
  return "low";
}

/**
 * Generate a human-readable summary for the risk score.
 */
function summarize(
  level: RiskLevel,
  score: number,
  breakdown: Pick<RiskBreakdown, "cycleTimeDelta" | "failureRateDelta" | "sentimentMultiplier">,
): string {
  const parts: string[] = [];

  if (level === "low") {
    parts.push(`Delivery risk is low (${score}/100).`);
    parts.push("Team velocity and pipeline stability are within healthy thresholds.");
  } else if (level === "moderate") {
    parts.push(`Delivery risk is moderate (${score}/100).`);
    if (breakdown.cycleTimeDelta > 0.3) {
      parts.push("Cycle times are above the elite benchmark.");
    }
    if (breakdown.failureRateDelta > 0.3) {
      parts.push("Failure rate is trending upward.");
    }
  } else if (level === "high") {
    parts.push(`Delivery risk is high (${score}/100).`);
    if (breakdown.cycleTimeDelta > 0.5) {
      parts.push("PRs are taking significantly longer to merge.");
    }
    if (breakdown.failureRateDelta > 0.5) {
      parts.push("Pipeline failures are impacting velocity.");
    }
  } else {
    parts.push(`Delivery risk is critical (${score}/100).`);
    parts.push("Immediate intervention recommended — team may be approaching burnout.");
  }

  if (breakdown.sentimentMultiplier > 1.0) {
    parts.push("Negative team sentiment is amplifying the risk signal.");
  }

  return parts.join(" ");
}

/**
 * Compute the Burnout Risk Score from DORA metrics and optional sentiment data.
 *
 * Formula:
 *   Risk = (ΔCycleTime × 0.6 + ΔFailureRate × 0.4) × sentimentMultiplier × 100
 */
export function computeRiskScore(input: RiskInput): RiskBreakdown {
  const { doraMetrics, sentimentNegativeRatio } = input;

  // --- Normalize deltas ---
  const cycleTimeDelta = normalizeDelta(
    doraMetrics.leadTimeForChanges.medianHours,
    ELITE_LEAD_TIME_HOURS,
    MAX_LEAD_TIME_HOURS,
  );

  const failureRateDelta = normalizeDelta(
    doraMetrics.changeFailureRate.percentage,
    ELITE_FAILURE_RATE_PCT,
    MAX_FAILURE_RATE_PCT,
  );

  // --- Sentiment multiplier ---
  // If negative sentiment is provided, scale it: 1.0 (neutral) → 1.5 (fully negative)
  let sentimentMultiplier = 1.0;
  if (sentimentNegativeRatio !== undefined && sentimentNegativeRatio > 0) {
    sentimentMultiplier = 1.0 + sentimentNegativeRatio * SENTIMENT_NEGATIVE_MULTIPLIER;
  }

  // --- Weighted score ---
  const rawScore =
    (cycleTimeDelta * CYCLE_TIME_WEIGHT + failureRateDelta * FAILURE_RATE_WEIGHT) *
    sentimentMultiplier;

  const score = Math.min(100, Math.max(0, Math.round(rawScore * 100)));
  const level = classifyRiskLevel(score);

  return {
    cycleTimeDelta: +cycleTimeDelta.toFixed(4),
    failureRateDelta: +failureRateDelta.toFixed(4),
    sentimentMultiplier: +sentimentMultiplier.toFixed(2),
    score,
    level,
    summary: summarize(level, score, { cycleTimeDelta, failureRateDelta, sentimentMultiplier }),
  };
}
