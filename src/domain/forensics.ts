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
  | "flaky-pipeline";

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
