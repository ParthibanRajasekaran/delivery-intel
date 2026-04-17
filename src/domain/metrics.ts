// ============================================================================
// Domain: Metric Result Contracts
// ============================================================================
// Every metric computed by the engine exposes not just a value but its
// confidence level, the evidence sources used, and any caveats — so callers
// (CLI, JSON, badge, dashboard) can be transparent with users.
// ============================================================================

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export type MetricConfidence = "high" | "medium" | "low" | "unknown";

// ---------------------------------------------------------------------------
// DORA performance tiers (2024 DORA Report benchmarks)
// ---------------------------------------------------------------------------

export type PerformanceTier = "Elite" | "High" | "Medium" | "Low" | "Unknown";

// ---------------------------------------------------------------------------
// Generic metric result wrapper
// ---------------------------------------------------------------------------

/** Sample size and observation window for a metric. */
export interface MetricCoverage {
  /** Number of data points used (e.g. deployments, PRs, runs). */
  sampleSize: number;
  /** Lookback window in days over which data was collected. */
  windowDays: number;
}

export interface MetricResult<T> {
  /** Stable key for this metric (machine-readable). */
  key: string;
  /** Computed value, or null if there was not enough evidence. */
  value: T | null;
  /** DORA performance tier. */
  tier: PerformanceTier;
  /** Confidence in the computed value. */
  confidence: MetricConfidence;
  /** Human-readable names of the evidence sources used (e.g. "GitHub Deployments API"). */
  evidenceSources: string[];
  /** Human-readable caveats, fallbacks, or assumptions that were applied. */
  caveats: string[];
  /**
   * True when this metric is approximated from a proxy signal (e.g. PRs instead of
   * deployment events). False when the DORA-defined primary signal was available.
   */
  isInferred: boolean;
  /** Sample size and observation window. */
  coverage: MetricCoverage;
  /**
   * Explicit assumptions that were made during computation. Surfaced to the user
   * so they can assess trustworthiness. Distinct from caveats (which are warnings).
   */
  assumptions: string[];
  /**
   * Concrete steps the repo owner can take to get a higher-confidence reading.
   * E.g. "Emit GitHub deployment events from CI/CD".
   */
  howToImproveAccuracy: string[];
}

// ---------------------------------------------------------------------------
// Concrete metric value types
// ---------------------------------------------------------------------------

export interface DeploymentFrequencyValue {
  deploymentsPerWeek: number;
  /** Which signal was used as the primary evidence. */
  signalType:
    | "deployment_statuses"
    | "deployments_api"
    | "workflow_runs"
    | "merged_prs"
    | "insufficient";
}

export interface ChangeLeadTimeValue {
  /** Commit-to-production median hours (DORA definition). Null if no prod deployment data. */
  commitToDeployMedianHours: number | null;
  /** PR-open-to-merge median hours (proxy metric when no deployment data). */
  prFlowMedianHours: number | null;
  /** Which value was used to compute the tier. */
  primarySignal: "commit_to_deploy" | "pr_flow" | "insufficient";
}

export interface FailedDeploymentRecoveryTimeValue {
  /** Median hours between a failed deployment and the next successful one. */
  medianHours: number;
  /** 75th-percentile recovery hours. */
  p75Hours: number;
  /** Number of recovery events used. */
  sampleSize: number;
}

export interface ChangeFailRateValue {
  /** Percentage of deployments that required recovery (rollback/hotfix). */
  percentage: number;
  /** Number of deployments classified as rework. */
  reworkCount: number;
  /** Total deployments evaluated. */
  totalDeployments: number;
}

export interface PipelineFailureRateValue {
  /** Percentage of completed workflow runs that concluded as "failure". */
  percentage: number;
  failedRuns: number;
  totalRuns: number;
}

export interface DeploymentReworkRateValue {
  /** Percentage of deployments inferred as rework (rollback, hotfix, revert). */
  percentage: number;
  reworkCount: number;
  totalDeployments: number;
}

export interface ReviewLatencyValue {
  /** Median hours from PR open to first review event (approximated by merge for now). */
  medianHours: number;
}

// ---------------------------------------------------------------------------
// Full metric suite
// ---------------------------------------------------------------------------

export interface MetricSuite {
  deploymentFrequency: MetricResult<DeploymentFrequencyValue>;
  changeLeadTime: MetricResult<ChangeLeadTimeValue>;
  failedDeploymentRecoveryTime: MetricResult<FailedDeploymentRecoveryTimeValue>;
  changeFailRate: MetricResult<ChangeFailRateValue>;
  pipelineFailureRate: MetricResult<PipelineFailureRateValue>;
  deploymentReworkRate: MetricResult<DeploymentReworkRateValue>;
  reviewLatency?: MetricResult<ReviewLatencyValue>;
}

// ---------------------------------------------------------------------------
// Tier thresholds (DORA 2024)
// ---------------------------------------------------------------------------

export function tierDeployFreq(perWeek: number): PerformanceTier {
  if (perWeek >= 7) {
    return "Elite";
  } // multiple times per day
  if (perWeek >= 1) {
    return "High";
  } // once per week to once per day
  if (perWeek >= 0.25) {
    return "Medium";
  } // once per week to once per month
  return "Low";
}

export function tierLeadTime(hours: number): PerformanceTier {
  if (hours < 24) {
    return "Elite";
  } // < 1 day
  if (hours < 168) {
    return "High";
  } // 1 day – 1 week
  if (hours < 720) {
    return "Medium";
  } // 1 week – 1 month
  return "Low";
}

export function tierRecoveryTime(hours: number): PerformanceTier {
  if (hours < 1) {
    return "Elite";
  } // < 1 hour
  if (hours < 24) {
    return "High";
  } // 1 hour – 1 day
  if (hours < 168) {
    return "Medium";
  } // 1 day – 1 week
  return "Low";
}

export function tierChangeFailRate(pct: number): PerformanceTier {
  if (pct <= 5) {
    return "Elite";
  }
  if (pct <= 10) {
    return "High";
  }
  if (pct <= 15) {
    return "Medium";
  }
  return "Low";
}

export function tierPipelineFailRate(pct: number): PerformanceTier {
  if (pct <= 5) {
    return "Elite";
  }
  if (pct <= 10) {
    return "High";
  }
  if (pct <= 20) {
    return "Medium";
  }
  return "Low";
}

export function tierReworkRate(pct: number): PerformanceTier {
  if (pct <= 2) {
    return "Elite";
  }
  if (pct <= 5) {
    return "High";
  }
  if (pct <= 10) {
    return "Medium";
  }
  return "Low";
}
