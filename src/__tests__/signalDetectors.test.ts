import { describe, it, expect } from "vitest";
import { computeForensicSignals } from "../scoring/forensicEngine";
import type { EvidenceEvent } from "../domain/evidence";
import type { MetricSuite } from "../domain/metrics";
import type { RawContributor } from "../domain/evidence";
import type { DependencyVulnerability } from "../types/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetricResult<T>(value: T | null, tier: string, confidence: string) {
  return {
    key: "test",
    value,
    tier: tier as "Elite" | "High" | "Medium" | "Low" | "Unknown",
    confidence: confidence as "high" | "medium" | "low" | "unknown",
    evidenceSources: ["test"],
    caveats: [],
    isInferred: false,
    coverage: { sampleSize: 10, windowDays: 30 },
    assumptions: [],
    howToImproveAccuracy: [],
  };
}

function makeDefaultMetrics(): MetricSuite {
  return {
    deploymentFrequency: makeMetricResult(
      { deploymentsPerWeek: 5, signalType: "deployments_api" as const },
      "High",
      "high",
    ),
    changeLeadTime: makeMetricResult(
      {
        commitToDeployMedianHours: 12,
        prFlowMedianHours: 8,
        primarySignal: "commit_to_deploy" as const,
      },
      "Elite",
      "high",
    ),
    failedDeploymentRecoveryTime: makeMetricResult(
      { medianHours: 2, p75Hours: 4, sampleSize: 5 },
      "High",
      "high",
    ),
    changeFailRate: makeMetricResult(
      { percentage: 5, reworkCount: 1, totalDeployments: 20 },
      "Elite",
      "high",
    ),
    pipelineFailureRate: makeMetricResult(
      { percentage: 3, failedRuns: 3, totalRuns: 100 },
      "Elite",
      "high",
    ),
    deploymentReworkRate: makeMetricResult(
      { percentage: 2, reworkCount: 1, totalDeployments: 50 },
      "Elite",
      "low",
    ),
  };
}

// ---------------------------------------------------------------------------
// release-hygiene
// ---------------------------------------------------------------------------

describe("signal: release-hygiene", () => {
  it("detects missing releases when commits exist", () => {
    const events: EvidenceEvent[] = [];
    for (let i = 0; i < 15; i++) {
      events.push({
        type: "CommitObserved",
        at: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
        sha: `sha${i}`,
        message: `fix: patch ${i}`,
      });
    }

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    const rh = signals.find((s) => s.id === "release-hygiene");
    expect(rh).toBeDefined();
    expect(rh!.title).toContain("No tagged releases");
  });

  it("does not trigger for repos with semver releases", () => {
    const events: EvidenceEvent[] = [];
    for (let i = 0; i < 15; i++) {
      events.push({
        type: "CommitObserved",
        at: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
        sha: `sha${i}`,
        message: `feat: feature ${i}`,
      });
    }
    events.push({
      type: "ReleasePublished",
      at: "2024-01-15T12:00:00Z",
      tagName: "v1.0.0",
      releaseName: "Release 1.0.0",
      prerelease: false,
    });

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    expect(signals.find((s) => s.id === "release-hygiene")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// rollback-signal
// ---------------------------------------------------------------------------

describe("signal: rollback-signal", () => {
  it("detects high rollback/hotfix ratio", () => {
    const events: EvidenceEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push({
        type: "PullRequestMerged",
        at: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
        prNumber: i,
        title: i < 3 ? `revert: undo PR ${i}` : `feat: feature ${i}`,
        labels: [],
        openedAt: `2024-01-${String(i + 1).padStart(2, "0")}T08:00:00Z`,
      });
    }

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    const rb = signals.find((s) => s.id === "rollback-signal");
    expect(rb).toBeDefined();
    expect(rb!.metric).toBe(30); // 3/10 = 30%
  });

  it("does not trigger for low rollback ratio", () => {
    const events: EvidenceEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push({
        type: "PullRequestMerged",
        at: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
        prNumber: i,
        title: `feat: feature ${i}`,
        labels: [],
        openedAt: `2024-01-${String(i + 1).padStart(2, "0")}T08:00:00Z`,
      });
    }

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    expect(signals.find((s) => s.id === "rollback-signal")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// maintainer-concentration
// ---------------------------------------------------------------------------

describe("signal: maintainer-concentration", () => {
  it("detects single-maintainer repos", () => {
    const contributors: RawContributor[] = [{ login: "alice", contributions: 100 }];
    const signals = computeForensicSignals([], makeDefaultMetrics(), {
      events: [],
      metrics: makeDefaultMetrics(),
      contributors,
    });
    const mc = signals.find((s) => s.id === "maintainer-concentration");
    expect(mc).toBeDefined();
    expect(mc!.title).toContain("Single maintainer");
  });

  it("detects dominant contributor", () => {
    const contributors: RawContributor[] = [
      { login: "alice", contributions: 95 },
      { login: "bob", contributions: 5 },
    ];
    const signals = computeForensicSignals([], makeDefaultMetrics(), {
      events: [],
      metrics: makeDefaultMetrics(),
      contributors,
    });
    const mc = signals.find((s) => s.id === "maintainer-concentration");
    expect(mc).toBeDefined();
    expect(mc!.metric).toBe(95);
  });

  it("does not trigger for distributed contributions", () => {
    const contributors: RawContributor[] = [
      { login: "alice", contributions: 40 },
      { login: "bob", contributions: 35 },
      { login: "carol", contributions: 25 },
    ];
    const signals = computeForensicSignals([], makeDefaultMetrics(), {
      events: [],
      metrics: makeDefaultMetrics(),
      contributors,
    });
    expect(signals.find((s) => s.id === "maintainer-concentration")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// incident-recoverability
// ---------------------------------------------------------------------------

describe("signal: incident-recoverability", () => {
  it("detects slow incident resolution", () => {
    const events: EvidenceEvent[] = [];
    // 5 incidents that took 96h to close
    for (let i = 0; i < 5; i++) {
      const openDate = `2024-01-${String(i * 5 + 1).padStart(2, "0")}T10:00:00Z`;
      const closeDate = `2024-01-${String(i * 5 + 5).padStart(2, "0")}T10:00:00Z`;
      events.push({
        type: "IssueClosed",
        at: closeDate,
        issueNumber: i,
        title: `Incident ${i}`,
        labels: ["incident"],
        openedAt: openDate,
      });
    }

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    const ir = signals.find((s) => s.id === "incident-recoverability");
    expect(ir).toBeDefined();
    expect(ir!.metric).toBeGreaterThan(24);
  });

  it("does not trigger for fast incident resolution", () => {
    const events: EvidenceEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push({
        type: "IssueClosed",
        at: `2024-01-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
        issueNumber: i,
        title: `Incident ${i}`,
        labels: ["incident"],
        openedAt: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      });
    }

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    expect(signals.find((s) => s.id === "incident-recoverability")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// dependency-exposure
// ---------------------------------------------------------------------------

describe("signal: dependency-exposure", () => {
  it("detects critical vulnerability exposure", () => {
    const vulns: DependencyVulnerability[] = [
      {
        packageName: "lodash",
        currentVersion: "4.17.0",
        vulnId: "CVE-2024-001",
        severity: "critical",
        summary: "prototype pollution",
        aliases: [],
        fixedVersion: "4.17.21",
      },
    ];

    const signals = computeForensicSignals([], makeDefaultMetrics(), {
      events: [],
      metrics: makeDefaultMetrics(),
      vulnerabilities: vulns,
    });
    const de = signals.find((s) => s.id === "dependency-exposure");
    expect(de).toBeDefined();
    expect(de!.severity).toBe("critical");
  });

  it("does not trigger for low-severity vulns only", () => {
    const vulns: DependencyVulnerability[] = [
      {
        packageName: "some-lib",
        currentVersion: "1.0.0",
        vulnId: "CVE-2024-100",
        severity: "low",
        summary: "info leak",
        aliases: [],
        fixedVersion: "1.0.1",
      },
    ];

    const signals = computeForensicSignals([], makeDefaultMetrics(), {
      events: [],
      metrics: makeDefaultMetrics(),
      vulnerabilities: vulns,
    });
    expect(signals.find((s) => s.id === "dependency-exposure")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// review-latency
// ---------------------------------------------------------------------------

describe("signal: review-latency", () => {
  it("detects slow PR review cycle", () => {
    const events: EvidenceEvent[] = [];
    for (let i = 0; i < 10; i++) {
      // PRs that take 72h to merge
      events.push({
        type: "PullRequestMerged",
        at: `2024-01-${String(i * 3 + 4).padStart(2, "0")}T10:00:00Z`,
        prNumber: i,
        title: `feat: feature ${i}`,
        labels: [],
        openedAt: `2024-01-${String(i * 3 + 1).padStart(2, "0")}T10:00:00Z`,
      });
    }

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    const rl = signals.find((s) => s.id === "review-latency");
    expect(rl).toBeDefined();
    expect(rl!.metric).toBeGreaterThan(48);
  });

  it("does not trigger for fast reviews", () => {
    const events: EvidenceEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push({
        type: "PullRequestMerged",
        at: `2024-01-${String(i + 1).padStart(2, "0")}T14:00:00Z`,
        prNumber: i,
        title: `feat: feature ${i}`,
        labels: [],
        openedAt: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      });
    }

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    expect(signals.find((s) => s.id === "review-latency")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// rework-density
// ---------------------------------------------------------------------------

describe("signal: rework-density", () => {
  it("detects high rework density", () => {
    const events: EvidenceEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push({
        type: "PullRequestMerged",
        at: `2024-01-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`,
        prNumber: i,
        title: i < 5 ? `hotfix: urgent fix ${i}` : `feat: feature ${i}`,
        labels: [],
        openedAt: `2024-01-${String((i % 28) + 1).padStart(2, "0")}T08:00:00Z`,
      });
    }

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    const rd = signals.find((s) => s.id === "rework-density");
    expect(rd).toBeDefined();
    expect(rd!.metric).toBe(25); // 5/20 = 25%
  });

  it("does not trigger when rework is low", () => {
    const events: EvidenceEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push({
        type: "PullRequestMerged",
        at: `2024-01-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`,
        prNumber: i,
        title: `feat: feature ${i}`,
        labels: [],
        openedAt: `2024-01-${String((i % 28) + 1).padStart(2, "0")}T08:00:00Z`,
      });
    }

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    expect(signals.find((s) => s.id === "rework-density")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// freshness-cadence
// ---------------------------------------------------------------------------

describe("signal: freshness-cadence", () => {
  it("detects stale repository", () => {
    const events: EvidenceEvent[] = [
      {
        type: "CommitObserved",
        at: "2023-01-01T10:00:00Z", // over a year old
        sha: "abc",
        message: "last commit",
      },
    ];

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    const fc = signals.find((s) => s.id === "freshness-cadence");
    expect(fc).toBeDefined();
    expect(fc!.severity).toBe("critical");
  });

  it("does not trigger for recent commits", () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const events: EvidenceEvent[] = [
      {
        type: "CommitObserved",
        at: recent.toISOString(),
        sha: "abc",
        message: "recent commit",
      },
    ];

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    expect(signals.find((s) => s.id === "freshness-cadence")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ci-flakiness
// ---------------------------------------------------------------------------

describe("signal: ci-flakiness", () => {
  it("detects high CI failure rate", () => {
    const events: EvidenceEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push({
        type: "WorkflowRunObserved",
        at: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
        runId: i,
        workflowName: "CI",
        event: "push",
        status: "completed",
        conclusion: i % 3 === 0 ? "failure" : "success", // ~33% failure
        headSha: `sha${i}`,
      });
    }

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    const ci = signals.find((s) => s.id === "ci-flakiness");
    expect(ci).toBeDefined();
    expect(ci!.metric).toBeGreaterThan(15);
  });

  it("does not trigger for reliable CI", () => {
    const events: EvidenceEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push({
        type: "WorkflowRunObserved",
        at: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
        runId: i,
        workflowName: "CI",
        event: "push",
        status: "completed",
        conclusion: "success",
        headSha: `sha${i}`,
      });
    }

    const signals = computeForensicSignals(events, makeDefaultMetrics());
    expect(signals.find((s) => s.id === "ci-flakiness")).toBeUndefined();
  });
});
