// ============================================================================
// Normalizer: GitHub raw evidence → internal EvidenceEvent stream
// ============================================================================
// This module is the single translation layer between what the GitHub APIs
// return and the typed event model that all metric engines consume.
// No metric logic lives here — only structural mapping.
// ============================================================================

import type { RawEvidenceBag, EvidenceEvent } from "../domain/evidence.js";

/**
 * Convert a RawEvidenceBag into a flat, time-sorted array of EvidenceEvents.
 * Metric engines consume this stream; they do not touch raw API payloads.
 */
export function normalizeEvidence(raw: RawEvidenceBag): EvidenceEvent[] {
  const events: EvidenceEvent[] = [];

  // Deployments
  for (const d of raw.deployments) {
    events.push({
      type: "DeploymentObserved",
      at: d.created_at,
      deploymentId: d.id,
      environment: d.environment,
      ref: d.ref,
      sha: d.sha,
    });
  }

  // Deployment statuses (most recent per deployment first)
  raw.deploymentStatuses.forEach((statuses, deploymentId) => {
    for (const s of statuses) {
      events.push({
        type: "DeploymentStatusObserved",
        at: s.created_at,
        deploymentId,
        state: s.state,
        environment: s.environment,
      });
    }
  });

  // Workflow runs
  for (const r of raw.workflowRuns) {
    events.push({
      type: "WorkflowRunObserved",
      at: r.created_at,
      runId: r.id,
      workflowName: r.name,
      event: r.event,
      status: r.status,
      conclusion: r.conclusion,
      headSha: r.head_sha,
    });
  }

  // Pull requests
  for (const pr of raw.pullRequests) {
    events.push({
      type: "PullRequestOpened",
      at: pr.created_at,
      prNumber: pr.number,
      title: pr.title,
      labels: pr.labels,
    });
    if (pr.merged_at) {
      events.push({
        type: "PullRequestMerged",
        at: pr.merged_at,
        prNumber: pr.number,
        title: pr.title,
        labels: pr.labels,
        openedAt: pr.created_at,
      });
    }
  }

  // Commits
  for (const c of raw.commits) {
    if (c.committed_at) {
      events.push({
        type: "CommitObserved",
        at: c.committed_at,
        sha: c.sha,
        message: c.message,
      });
    }
  }

  // Releases
  for (const r of raw.releases) {
    const at = r.published_at ?? r.created_at;
    events.push({
      type: "ReleasePublished",
      at,
      tagName: r.tag_name,
      releaseName: r.name,
      prerelease: r.prerelease,
    });
  }

  // Issues
  for (const i of raw.issues) {
    events.push({
      type: "IssueOpened",
      at: i.created_at,
      issueNumber: i.number,
      title: i.title,
      labels: i.labels,
    });
    if (i.closed_at) {
      events.push({
        type: "IssueClosed",
        at: i.closed_at,
        issueNumber: i.number,
        title: i.title,
        labels: i.labels,
        openedAt: i.created_at,
      });
    }
  }

  // Sort chronologically ascending
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return events;
}

// ---------------------------------------------------------------------------
// Helpers for metric engines to slice the event stream
// ---------------------------------------------------------------------------

export function eventsInWindow(events: EvidenceEvent[], from: Date, to: Date): EvidenceEvent[] {
  return events.filter((e) => {
    const t = new Date(e.at).getTime();
    return t >= from.getTime() && t <= to.getTime();
  });
}

export function eventsByType<T extends EvidenceEvent["type"]>(
  events: EvidenceEvent[],
  type: T,
): Extract<EvidenceEvent, { type: T }>[] {
  return events.filter((e): e is Extract<EvidenceEvent, { type: T }> => e.type === type);
}
