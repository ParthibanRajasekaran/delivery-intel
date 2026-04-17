// ============================================================================
// Domain: Evidence Events
// ============================================================================
// All raw GitHub and OSV data is normalized into these typed event structs
// before any metric is computed. This makes the system auditable — every
// metric value can be traced back to the concrete evidence events that
// produced it.
// ============================================================================

// ---------------------------------------------------------------------------
// Raw evidence containers (one per collector)
// ---------------------------------------------------------------------------

export interface RawDeployment {
  id: number;
  sha: string;
  ref: string;
  environment: string;
  created_at: string;
  updated_at: string;
  description: string | null;
}

export interface RawDeploymentStatus {
  id: number;
  deploymentId: number;
  state:
    | "error"
    | "failure"
    | "inactive"
    | "in_progress"
    | "queued"
    | "pending"
    | "success"
    | string;
  environment: string | null;
  created_at: string;
}

export interface RawWorkflowRun {
  id: number;
  name: string | null;
  workflow_id: number;
  event: string;
  status: string | null;
  conclusion: string | null;
  head_sha: string;
  created_at: string;
  updated_at: string;
  run_attempt: number;
}

export interface RawPullRequest {
  number: number;
  title: string;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  head_sha: string | null;
  labels: string[];
}

export interface RawCommit {
  sha: string;
  committed_at: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Normalized internal evidence events
// ---------------------------------------------------------------------------

export type EvidenceEvent =
  | {
      type: "PullRequestOpened";
      at: string;
      prNumber: number;
      title: string;
      labels: string[];
    }
  | {
      type: "PullRequestMerged";
      at: string;
      prNumber: number;
      title: string;
      labels: string[];
      openedAt: string;
    }
  | {
      type: "CommitObserved";
      at: string;
      sha: string;
      message: string;
    }
  | {
      type: "DeploymentObserved";
      at: string;
      deploymentId: number;
      environment: string;
      ref: string;
      sha: string;
    }
  | {
      type: "DeploymentStatusObserved";
      at: string;
      deploymentId: number;
      state: RawDeploymentStatus["state"];
      environment: string | null;
    }
  | {
      type: "WorkflowRunObserved";
      at: string;
      runId: number;
      workflowName: string | null;
      event: string;
      status: string | null;
      conclusion: string | null;
      headSha: string;
    }
  | {
      type: "DependencyObserved";
      at: string;
      ecosystem: string;
      name: string;
      version: string;
      source: string; // e.g. "package.json", "requirements.txt"
    }
  | {
      type: "VulnerabilityObserved";
      at: string;
      ecosystem: string;
      name: string;
      version: string;
      vulnId: string;
      severity: string;
      summary: string;
      aliases: string[];
      fixedVersion: string | null;
    };

// ---------------------------------------------------------------------------
// Collected raw evidence (one bag per collection pass)
// ---------------------------------------------------------------------------

export interface RawEvidenceBag {
  deployments: RawDeployment[];
  deploymentStatuses: Map<number, RawDeploymentStatus[]>; // keyed by deploymentId
  workflowRuns: RawWorkflowRun[];
  pullRequests: RawPullRequest[];
  commits: RawCommit[];
  /** Manifest file path → content */
  manifestFiles: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Production environment classifier
// ---------------------------------------------------------------------------

const PRODUCTION_ENVIRONMENT_PATTERNS = [
  /^prod(uction)?$/i,
  /^live$/i,
  /^main$/i,
  /^release$/i,
  /^stable$/i,
];

export function isProductionEnvironment(environment: string): boolean {
  return PRODUCTION_ENVIRONMENT_PATTERNS.some((re) => re.test(environment));
}

// ---------------------------------------------------------------------------
// Rollback / hotfix signal heuristics
// ---------------------------------------------------------------------------

const ROLLBACK_TITLE_PATTERNS = [/\brevert\b/i, /\brollback\b/i, /\broll.back\b/i];

const HOTFIX_TITLE_PATTERNS = [/\bhotfix\b/i, /\bhot.fix\b/i, /\burgent.fix\b/i, /\bquickfix\b/i];

const REWORK_LABELS = ["hotfix", "rollback", "revert", "incident", "fix-forward"];

export function isRollbackSignal(title: string, labels: string[]): boolean {
  if (ROLLBACK_TITLE_PATTERNS.some((re) => re.test(title))) {
    return true;
  }
  return labels.some((l) => REWORK_LABELS.includes(l.toLowerCase()));
}

export function isHotfixSignal(title: string, labels: string[]): boolean {
  if (HOTFIX_TITLE_PATTERNS.some((re) => re.test(title))) {
    return true;
  }
  return labels.some((l) => ["hotfix", "incident"].includes(l.toLowerCase()));
}
