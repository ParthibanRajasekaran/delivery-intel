// ============================================================================
// Domain: Repository Evidence Profile
// ============================================================================
// Before computing any metric the orchestrator runs a profiling pass that
// characterises what kind of evidence the repo actually has. This drives:
//   - metric engine fallback selection
//   - confidence levels
//   - caveats shown to users
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** How strong is the production deployment signal? */
export type ProductionSignalStrength = "high" | "medium" | "low" | "none";

export interface RepoEvidenceProfile {
  /** GitHub Deployments API returned ≥ 1 deployment. */
  hasDeploymentsApiData: boolean;
  /** At least one deployment has a "success" or "failure" status. */
  hasDeploymentStatuses: boolean;
  /** At least one deployment targets a production-like environment. */
  hasProductionDeployments: boolean;
  /** GitHub Actions workflow runs were found. */
  hasActionsRuns: boolean;
  /** Merged PR history with ≥ 5 PRs. */
  hasMergedPrHistory: boolean;
  /** Commit history found. */
  hasCommitHistory: boolean;
  /** At least one dependency manifest was readable. */
  hasDependencyManifest: boolean;
  /** Enough history (≥ 14 days of events) for reliable trend computation. */
  hasSufficientHistory: boolean;
  /**
   * How trustworthy is the production deployment signal?
   * - high:   deployment statuses with explicit success/failure on prod env
   * - medium: deployments exist but no explicit statuses or non-prod env only
   * - low:    only workflow runs / merged PRs available
   * - none:   no deployment signal at all
   */
  productionSignalStrength: ProductionSignalStrength;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

import type { RawEvidenceBag, RawDeploymentStatus } from "./evidence.js";
import { isProductionEnvironment } from "./evidence.js";

export function buildRepoEvidenceProfile(raw: RawEvidenceBag): RepoEvidenceProfile {
  const hasDeploymentsApiData = raw.deployments.length > 0;

  const allStatuses: RawDeploymentStatus[] = [];
  raw.deploymentStatuses.forEach((statuses) => allStatuses.push(...statuses));

  const hasDeploymentStatuses =
    allStatuses.some((s) => s.state === "success" || s.state === "failure") ?? false;

  const hasProductionDeployments =
    raw.deployments.some((d) => isProductionEnvironment(d.environment)) ||
    allStatuses.some((s) => s.environment !== null && isProductionEnvironment(s.environment ?? ""));

  const hasActionsRuns = raw.workflowRuns.length > 0;

  const mergedPRs = raw.pullRequests.filter((pr) => pr.merged_at !== null);
  const hasMergedPrHistory = mergedPRs.length >= 5;

  const hasCommitHistory = raw.commits.length > 0;
  const hasDependencyManifest = raw.manifestFiles.size > 0;

  // Sufficient history: events spanning ≥ 14 days
  const allDates: Date[] = [
    ...raw.deployments.map((d) => new Date(d.created_at)),
    ...mergedPRs.filter((pr) => pr.merged_at).map((pr) => new Date(pr.merged_at!)),
    ...raw.workflowRuns.map((r) => new Date(r.created_at)),
  ].filter((d) => !Number.isNaN(d.getTime()));

  let hasSufficientHistory = false;
  if (allDates.length >= 2) {
    const oldest = Math.min(...allDates.map((d) => d.getTime()));
    const newest = Math.max(...allDates.map((d) => d.getTime()));
    const spanDays = (newest - oldest) / (1000 * 60 * 60 * 24);
    hasSufficientHistory = spanDays >= 14;
  }

  // Production signal strength
  let productionSignalStrength: ProductionSignalStrength = "none";
  if (hasDeploymentStatuses && hasProductionDeployments) {
    productionSignalStrength = "high";
  } else if (hasDeploymentsApiData && hasProductionDeployments) {
    productionSignalStrength = "medium";
  } else if (hasDeploymentsApiData || hasActionsRuns) {
    productionSignalStrength = "low";
  }

  return {
    hasDeploymentsApiData,
    hasDeploymentStatuses,
    hasProductionDeployments,
    hasActionsRuns,
    hasMergedPrHistory,
    hasCommitHistory,
    hasDependencyManifest,
    hasSufficientHistory,
    productionSignalStrength,
  };
}
