// ============================================================================
// Domain: Scoring Contracts
// ============================================================================
// Replaces the opaque single-score average with a multi-dimensional,
// confidence-weighted breakdown. Each component contributes a named value
// with a weight and a confidence-adjusted influence.
// ============================================================================

import type { MetricConfidence, PerformanceTier } from "./metrics.js";

// ---------------------------------------------------------------------------
// Score component
// ---------------------------------------------------------------------------

export interface ScoreComponent {
  /** Machine-readable name. */
  name: string;
  /** Normalized 0–100 contribution before weighting. */
  rawScore: number;
  /** Nominal weight (0–1, all weights sum to 1.0 within a ScoreBreakdown). */
  weight: number;
  /**
   * Effective weight after confidence adjustment.
   * low-confidence metrics contribute less to the total than their nominal weight.
   */
  effectiveWeight: number;
  /** Human-readable explanation of the score for this component. */
  explanation: string;
}

// ---------------------------------------------------------------------------
// Score breakdown
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  /** Final 0–100 score. */
  score: number;
  /** Aggregate confidence of all inputs. */
  confidence: MetricConfidence;
  components: ScoreComponent[];
  /** Human-readable caveats about this score. */
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Tier → raw score mapping
// ---------------------------------------------------------------------------

const TIER_SCORES: Record<PerformanceTier, number> = {
  Elite: 100,
  High: 75,
  Medium: 50,
  Low: 25,
  Unknown: 50, // neutral when we can't tell
};

export function tierToScore(tier: PerformanceTier): number {
  return TIER_SCORES[tier];
}

// ---------------------------------------------------------------------------
// Confidence → weight multiplier
// ---------------------------------------------------------------------------

const CONFIDENCE_MULTIPLIERS: Record<MetricConfidence, number> = {
  high: 1.0,
  medium: 0.8,
  low: 0.5,
  unknown: 0.3,
};

export function confidenceMultiplier(c: MetricConfidence): number {
  return CONFIDENCE_MULTIPLIERS[c];
}

// ---------------------------------------------------------------------------
// Aggregate confidence from a list of component confidences
// ---------------------------------------------------------------------------

export function aggregateConfidence(confidences: MetricConfidence[]): MetricConfidence {
  const scores: Record<MetricConfidence, number> = {
    high: 3,
    medium: 2,
    low: 1,
    unknown: 0,
  };
  if (confidences.length === 0) {
    return "unknown";
  }
  const avg = confidences.reduce((s, c) => s + scores[c], 0) / confidences.length;
  if (avg >= 2.5) {
    return "high";
  }
  if (avg >= 1.5) {
    return "medium";
  }
  if (avg >= 0.5) {
    return "low";
  }
  return "unknown";
}
