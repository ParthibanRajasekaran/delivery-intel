// ============================================================================
// Compare Engine — Side-by-side repo trust comparison
// ============================================================================
// Runs analyzeV2 on two repos and produces a structured comparison result
// that highlights differences in trust dimensions, signals, and metrics.
// ============================================================================

import type { AnalysisResultV2 } from "./analyzerV2.js";
import type { TrustVerdict, TrustDimension, ForensicSignal } from "../domain/forensics.js";
import type { MetricSuite } from "../domain/metrics.js";

// ---------------------------------------------------------------------------
// Comparison result types
// ---------------------------------------------------------------------------

export interface DimensionComparison {
  name: string;
  repoA: number;
  repoB: number;
  delta: number; // positive = A is better
  winner: "a" | "b" | "tie";
}

export interface MetricComparison {
  name: string;
  tierA: string;
  tierB: string;
  winner: "a" | "b" | "tie";
}

export interface CompareResult {
  repoA: string;
  repoB: string;
  trustScoreA: number | null;
  trustScoreB: number | null;
  trustLevelA: string | null;
  trustLevelB: string | null;
  winner: "a" | "b" | "tie" | "insufficient";
  /** Per-dimension comparison (only when both have trust verdicts). */
  dimensions: DimensionComparison[];
  /** Per-DORA-metric tier comparison. */
  metrics: MetricComparison[];
  /** Signals unique to repo A. */
  uniqueSignalsA: string[];
  /** Signals unique to repo B. */
  uniqueSignalsB: string[];
  /** One-line comparison headline. */
  headline: string;
  /** 2-3 sentence narrative. */
  narrative: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIER_ORDER: Record<string, number> = {
  Elite: 4,
  High: 3,
  Medium: 2,
  Low: 1,
  Unknown: 0,
};

function compareTiers(a: string, b: string): "a" | "b" | "tie" {
  const va = TIER_ORDER[a] ?? 0;
  const vb = TIER_ORDER[b] ?? 0;
  if (va > vb) {
    return "a";
  }
  if (vb > va) {
    return "b";
  }
  return "tie";
}

function extractTrustVerdict(result: AnalysisResultV2): TrustVerdict | null {
  const v = result.verdict;
  if ("trustLevel" in v && "trustScore" in v) {
    return v as TrustVerdict;
  }
  return null;
}

function buildDimensionComparisons(
  dimsA: TrustDimension[],
  dimsB: TrustDimension[],
): DimensionComparison[] {
  const bMap = new Map(dimsB.map((d) => [d.name, d]));
  return dimsA.map((da) => {
    const db = bMap.get(da.name);
    const scoreB = db?.score ?? 0;
    const delta = da.score - scoreB;
    return {
      name: da.name,
      repoA: da.score,
      repoB: scoreB,
      delta,
      winner: delta > 5 ? ("a" as const) : delta < -5 ? ("b" as const) : ("tie" as const),
    };
  });
}

function buildMetricComparisons(a: MetricSuite, b: MetricSuite): MetricComparison[] {
  const keys: Array<{ key: keyof MetricSuite; name: string }> = [
    { key: "deploymentFrequency", name: "Deployment Frequency" },
    { key: "changeLeadTime", name: "Change Lead Time" },
    { key: "changeFailRate", name: "Change Fail Rate" },
    { key: "failedDeploymentRecoveryTime", name: "Recovery Time" },
    { key: "pipelineFailureRate", name: "Pipeline Failure Rate" },
  ];
  return keys.map(({ key, name }) => ({
    name,
    tierA: a[key]!.tier,
    tierB: b[key]!.tier,
    winner: compareTiers(a[key]!.tier, b[key]!.tier),
  }));
}

function signalIds(signals: ForensicSignal[]): Set<string> {
  return new Set(signals.map((s) => s.id));
}

function generateHeadline(
  repoA: string,
  repoB: string,
  scoreA: number | null,
  scoreB: number | null,
  winner: "a" | "b" | "tie" | "insufficient",
): string {
  if (winner === "insufficient") {
    return `Cannot compare — insufficient evidence for one or both repos`;
  }
  if (winner === "tie") {
    return `${repoA} and ${repoB} are comparable in trust`;
  }
  const w = winner === "a" ? repoA : repoB;
  const diff = Math.abs((scoreA ?? 0) - (scoreB ?? 0));
  return `${w} scores ${diff} points higher in trust`;
}

function generateNarrative(
  repoA: string,
  repoB: string,
  dims: DimensionComparison[],
  winner: "a" | "b" | "tie" | "insufficient",
): string {
  if (winner === "insufficient") {
    return (
      `One or both repositories lack sufficient evidence for a meaningful comparison. ` +
      `Run both analyses with --mode adopt to generate trust verdicts first.`
    );
  }

  const aWins = dims.filter((d) => d.winner === "a").map((d) => d.name.toLowerCase());
  const bWins = dims.filter((d) => d.winner === "b").map((d) => d.name.toLowerCase());

  const parts: string[] = [];
  if (aWins.length > 0) {
    parts.push(`${repoA} is stronger in ${aWins.join(", ")}`);
  }
  if (bWins.length > 0) {
    parts.push(`${repoB} leads in ${bWins.join(", ")}`);
  }
  if (parts.length === 0) {
    parts.push("Both repos show similar trust profiles across all dimensions");
  }

  return parts.join(". ") + ".";
}

// ---------------------------------------------------------------------------
// Public: compare two analysis results
// ---------------------------------------------------------------------------

export function compareRepos(resultA: AnalysisResultV2, resultB: AnalysisResultV2): CompareResult {
  const repoA = `${resultA.repo.owner}/${resultA.repo.repo}`;
  const repoB = `${resultB.repo.owner}/${resultB.repo.repo}`;

  const trustA = extractTrustVerdict(resultA);
  const trustB = extractTrustVerdict(resultB);

  const scoreA = trustA?.trustScore ?? null;
  const scoreB = trustB?.trustScore ?? null;
  const levelA = trustA?.trustLevel ?? null;
  const levelB = trustB?.trustLevel ?? null;

  // Determine winner
  let winner: "a" | "b" | "tie" | "insufficient";
  if (scoreA === null || scoreB === null) {
    winner = "insufficient";
  } else if (Math.abs(scoreA - scoreB) <= 5) {
    winner = "tie";
  } else {
    winner = scoreA > scoreB ? "a" : "b";
  }

  // Dimension comparison
  const dimensions =
    trustA && trustB
      ? buildDimensionComparisons(trustA.trustDimensions, trustB.trustDimensions)
      : [];

  // Metric comparison
  const metrics = buildMetricComparisons(resultA.metrics, resultB.metrics);

  // Unique signals
  const idsA = signalIds(resultA.forensics);
  const idsB = signalIds(resultB.forensics);
  const uniqueSignalsA = [...idsA].filter((id) => !idsB.has(id));
  const uniqueSignalsB = [...idsB].filter((id) => !idsA.has(id));

  return {
    repoA,
    repoB,
    trustScoreA: scoreA,
    trustScoreB: scoreB,
    trustLevelA: levelA,
    trustLevelB: levelB,
    winner,
    dimensions,
    metrics,
    uniqueSignalsA,
    uniqueSignalsB,
    headline: generateHeadline(repoA, repoB, scoreA, scoreB, winner),
    narrative: generateNarrative(repoA, repoB, dimensions, winner),
  };
}
