// ============================================================================
// Domain: Forensic Signals + Repo Verdict
// ============================================================================
// Forensic signals are higher-order observations derived from raw evidence.
// They go beyond DORA metrics to surface *why* a repo behaves the way it does.
//
// A RepoVerdict is the categorical judgment: "Fast but fragile", "Reliable
// but slow", etc. — an actionable sentence, not just a number.
// ============================================================================

// ---------------------------------------------------------------------------
// Forensic signal types
// ---------------------------------------------------------------------------

export type ForensicSignalId =
  | "merge-to-deploy-lag"
  | "deploy-burstiness"
  | "failed-run-clustering"
  | "recovery-asymmetry"
  | "deploy-drought"
  | "flaky-pipeline"
  // Layer 2 decision signals
  | "release-hygiene"
  | "rollback-signal"
  | "maintainer-concentration"
  | "incident-recoverability"
  | "dependency-exposure"
  | "review-latency"
  | "rework-density"
  | "freshness-cadence"
  | "ci-flakiness";

export type ForensicSeverity = "critical" | "warning" | "info";

export interface ForensicSignal {
  id: ForensicSignalId;
  title: string;
  severity: ForensicSeverity;
  /** Human-readable evidence description. */
  evidence: string;
  /** Quantified signal value (null if boolean signal). */
  metric: number | null;
  /** Threshold that triggered this signal. */
  threshold: number;
  /** What to do about it. */
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Repo verdict
// ---------------------------------------------------------------------------

export type VerdictCategory =
  | "exemplary"
  | "fast-but-fragile"
  | "reliable-but-slow"
  | "improving"
  | "unstable"
  | "unknown";

export interface RepoVerdict {
  category: VerdictCategory;
  /** One-line headline, e.g. "Fast but fragile". */
  headline: string;
  /** 2-3 sentence explanation of why this verdict was reached. */
  narrative: string;
  /** Top positive observations. */
  strengths: string[];
  /** Top concerns. */
  risks: string[];
  /** The single most impactful action to take. */
  firstFix: string;
}

// ---------------------------------------------------------------------------
// Analysis mode
// ---------------------------------------------------------------------------

export type AnalysisMode = "oss" | "adopt" | "pr" | "exec" | "platform";

export const ANALYSIS_MODES: Record<AnalysisMode, string> = {
  oss: "Open-source maintainer — focus on community health, contributor flow, security hygiene",
  adopt: "Adoption assessment — is this repo safe to depend on?",
  pr: "Pull request guardrail — regression check against baseline",
  exec: "Executive summary — high-level delivery health for leadership",
  platform: "Platform engineering — multi-repo comparison, fleet health",
};

// ---------------------------------------------------------------------------
// Mode-specific signal weights
// ---------------------------------------------------------------------------
// Each mode selects which signals matter and how heavily they affect the
// verdict. Signals not listed get weight 0 (ignored for that mode).

export type SignalWeight = Record<ForensicSignalId, number>;

export const MODE_SIGNAL_WEIGHTS: Record<AnalysisMode, Partial<SignalWeight>> = {
  adopt: {
    "freshness-cadence": 1.0,
    "ci-flakiness": 0.9,
    "dependency-exposure": 0.9,
    "release-hygiene": 0.8,
    "maintainer-concentration": 0.8,
    "rollback-signal": 0.6,
    "rework-density": 0.5,
    "deploy-drought": 0.7,
    "flaky-pipeline": 0.6,
    "recovery-asymmetry": 0.4,
  },
  pr: {
    "ci-flakiness": 1.0,
    "flaky-pipeline": 0.9,
    "rework-density": 0.8,
    "rollback-signal": 0.8,
    "failed-run-clustering": 0.7,
    "recovery-asymmetry": 0.6,
    "merge-to-deploy-lag": 0.5,
  },
  platform: {
    "release-hygiene": 0.9,
    "maintainer-concentration": 0.8,
    "dependency-exposure": 0.8,
    "ci-flakiness": 0.7,
    "deploy-burstiness": 0.6,
    "freshness-cadence": 0.7,
    "flaky-pipeline": 0.6,
  },
  exec: {
    "deploy-drought": 0.8,
    "recovery-asymmetry": 0.7,
    "dependency-exposure": 0.6,
    "rework-density": 0.5,
    "freshness-cadence": 0.5,
  },
  oss: {
    "maintainer-concentration": 1.0,
    "freshness-cadence": 0.9,
    "dependency-exposure": 0.8,
    "release-hygiene": 0.7,
    "ci-flakiness": 0.6,
    "review-latency": 0.8,
    "rework-density": 0.5,
  },
};

// ---------------------------------------------------------------------------
// Trust verdict (for --mode adopt)
// ---------------------------------------------------------------------------

export type TrustLevel = "high" | "moderate" | "low" | "insufficient-evidence";

export interface TrustVerdict extends RepoVerdict {
  trustLevel: TrustLevel;
  /** 0-100 composite trust score. */
  trustScore: number;
  /** Per-dimension trust breakdown. */
  trustDimensions: TrustDimension[];
}

export interface TrustDimension {
  name: string;
  score: number; // 0-100
  weight: number;
  signals: string[];
}
