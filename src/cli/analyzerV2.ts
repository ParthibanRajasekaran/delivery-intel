// ============================================================================
// analyzeV2 — Evidence-Driven Orchestrator
// ============================================================================
// This is the pivot point of the refactored architecture. It coordinates:
//   1. Collectors   — fetch raw data from external APIs
//   2. Profiler     — characterise what evidence is available
//   3. Normalizer   — translate raw data into typed EvidenceEvents
//   4. Metric engines — compute each metric from events
//   5. Security     — extract deps and scan via OSV batch API
//   6. Scoring      — confidence-weighted composite score
//   7. Recommendations — ranked actionable suggestions
//
// The original analyze() function is preserved for backwards compatibility.
// ============================================================================

import { createOctokit, parseRepoSlug } from "../shared/github.js";
import type { RepoIdentifier } from "../shared/github.js";

// Collectors
import { collectDeployments, collectDeploymentStatuses } from "../collectors/github/deployments.js";
import { collectWorkflowRuns } from "../collectors/github/workflowRuns.js";
import { collectPullRequests } from "../collectors/github/pullRequests.js";
import { collectCommits } from "../collectors/github/commits.js";
import { collectManifestFiles } from "../collectors/github/contents.js";

// Domain
import type { RawEvidenceBag } from "../domain/evidence.js";
import type { MetricSuite } from "../domain/metrics.js";
import type { RepoEvidenceProfile } from "../domain/repoProfile.js";
import { buildRepoEvidenceProfile } from "../domain/repoProfile.js";
import type { ScoreBreakdown } from "../domain/scoring.js";

// Normalizer
import { normalizeEvidence } from "../normalize/githubEvidence.js";
import type { EvidenceEvent } from "../domain/evidence.js";

// Metric engines
import {
  computeDeploymentFrequency,
  deploymentDailyBuckets,
} from "../metrics/deploymentFrequency.js";
import { computeChangeLeadTime } from "../metrics/changeLeadTime.js";
import { computeFailedDeploymentRecoveryTime } from "../metrics/failedDeploymentRecoveryTime.js";
import { computeChangeFailRate } from "../metrics/changeFailRate.js";
import { computePipelineFailureRate } from "../metrics/pipelineFailureRate.js";
import { computeDeploymentReworkRate } from "../metrics/deploymentReworkRate.js";

// Security
import { extractAllDependencies } from "../security/extractors/index.js";
import { scanVulnerabilitiesV2 } from "../security/vulnerabilityEngine.js";

// Scoring
import { computeDeliveryScore } from "../scoring/deliveryScore.js";
import { generateRecommendationsV2 } from "../scoring/recommendationEngine.js";

// Types re-exported from the v1 analyzer for shared use
import type { DependencyVulnerability, Suggestion } from "./analyzer.js";

// ---------------------------------------------------------------------------
// V2 result types
// ---------------------------------------------------------------------------

export interface AnalysisResultV2 {
  /** Schema version — consumers can branch on this. */
  schemaVersion: 2;
  repo: RepoIdentifier;
  fetchedAt: string;
  /** Characterises the quality and type of evidence found in this repo. */
  repoProfile: RepoEvidenceProfile;
  metrics: MetricSuite;
  vulnerabilities: DependencyVulnerability[];
  /** Which manifest files were scanned. */
  scannedManifests: string[];
  scores: {
    delivery: ScoreBreakdown;
  };
  /** Ranked actionable recommendations. */
  recommendations: Suggestion[];
  /** Deployment counts for the last 7 days (index 0 = 6 days ago, index 6 = today). */
  dailyDeployments: number[];
}

// ---------------------------------------------------------------------------
// Collection phase
// ---------------------------------------------------------------------------

async function collectEvidence(
  id: RepoIdentifier,
  octokit: ReturnType<typeof createOctokit>,
): Promise<RawEvidenceBag> {
  // Fetch deployments first (need IDs to fetch statuses)
  const deployments = await collectDeployments(octokit, id, 100);
  const deploymentIds = deployments.map((d) => d.id);

  // Fetch everything else in parallel
  const [deploymentStatuses, workflowRuns, pullRequests, commits, manifestFiles] =
    await Promise.all([
      collectDeploymentStatuses(octokit, id, deploymentIds),
      collectWorkflowRuns(octokit, id, 100),
      collectPullRequests(octokit, id, 100),
      collectCommits(octokit, id, 50),
      collectManifestFiles(octokit, id),
    ]);

  return {
    deployments,
    deploymentStatuses,
    workflowRuns,
    pullRequests,
    manifestFiles,
    commits,
  };
}

// ---------------------------------------------------------------------------
// Metric computation phase
// ---------------------------------------------------------------------------

function computeMetrics(events: EvidenceEvent[], profile: RepoEvidenceProfile): MetricSuite {
  return {
    deploymentFrequency: computeDeploymentFrequency(events, profile),
    changeLeadTime: computeChangeLeadTime(events, profile),
    failedDeploymentRecoveryTime: computeFailedDeploymentRecoveryTime(events, profile),
    changeFailRate: computeChangeFailRate(events, profile),
    pipelineFailureRate: computePipelineFailureRate(events, profile),
    deploymentReworkRate: computeDeploymentReworkRate(events, profile),
  };
}

// ---------------------------------------------------------------------------
// Public: analyzeV2
// ---------------------------------------------------------------------------

export async function analyzeV2(repoSlug: string, token?: string): Promise<AnalysisResultV2> {
  const repo = parseRepoSlug(repoSlug);
  const octokit = createOctokit(token);

  // 1. Collect raw evidence
  const rawEvidence = await collectEvidence(repo, octokit);

  // 2. Profile the repo (determines confidence levels and fallback paths)
  const repoProfile = buildRepoEvidenceProfile(rawEvidence);

  // 3. Normalise raw evidence → typed event stream
  const events = normalizeEvidence(rawEvidence);

  // 4. Compute metrics from events
  const metrics = computeMetrics(events, repoProfile);

  // 5. Extract dependencies and scan for vulnerabilities
  const { deps, sources } = extractAllDependencies(rawEvidence.manifestFiles);
  const vulnerabilities = await scanVulnerabilitiesV2(deps);

  // 6. Score
  const deliveryScore = computeDeliveryScore(metrics, vulnerabilities);

  // 7. Recommendations
  const recommendations = generateRecommendationsV2(metrics, vulnerabilities, deliveryScore);

  // 8. Daily sparkline
  const dailyDeployments = deploymentDailyBuckets(events);

  return {
    schemaVersion: 2,
    repo,
    fetchedAt: new Date().toISOString(),
    repoProfile,
    metrics,
    vulnerabilities,
    scannedManifests: sources,
    scores: { delivery: deliveryScore },
    recommendations,
    dailyDeployments,
  };
}
