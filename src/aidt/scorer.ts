// ============================================================================
// AIDT — Scorer
// ============================================================================
// Pure computation: risk weight → canary duration → risk tier.
// No I/O or side effects.
// ============================================================================

/** Fallback baseline density in seconds/line when fewer than 10 qualifying PRs exist. */
export const BASELINE_FALLBACK = 6.0;

/**
 * Compute the composite risk weight (0.0–1.0, 3dp).
 * risk_weight = round((ai_authorship_pct * 0.6) + (density_risk * 0.4), 3)
 */
export function computeRiskWeight(
  aiAuthorshipPct: number,
  reviewTimePerLoc: number,
  baselineDensity: number,
): number {
  const densityRisk = Math.max(0.0, 1.0 - reviewTimePerLoc / baselineDensity);
  const raw = aiAuthorshipPct * 0.6 + densityRisk * 0.4;
  return Math.round(raw * 1000) / 1000;
}

/** Resolve the recommended canary deployment duration in minutes. */
export function resolveCanaryDuration(riskWeight: number): 30 | 60 | 240 {
  if (riskWeight > 0.7) {
    return 240;
  }
  if (riskWeight > 0.45) {
    return 60;
  }
  return 30;
}

/** Resolve the risk tier label from the risk weight. */
export function resolveRiskTier(riskWeight: number): "low" | "medium" | "high" {
  if (riskWeight > 0.7) {
    return "high";
  }
  if (riskWeight > 0.45) {
    return "medium";
  }
  return "low";
}

/** Build the human-readable recommendation string. */
export function buildRecommendation(
  riskTier: "low" | "medium" | "high",
  canaryDuration: number,
): string {
  switch (riskTier) {
    case "high":
      return `Extend canary to ${canaryDuration} minutes before progressive traffic ramp-up`;
    case "medium":
      return `Hold canary for ${canaryDuration} minutes and monitor error rate before promoting`;
    case "low":
      return `Standard ${canaryDuration}-minute canary window is sufficient`;
  }
}
