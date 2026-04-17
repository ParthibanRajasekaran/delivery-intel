import { describe, it, expect } from "vitest";
import { computeForensicSignals } from "../scoring/forensicEngine";
import type { EvidenceEvent } from "../domain/evidence";
import type { MetricSuite } from "../domain/metrics";

// ---------------------------------------------------------------------------
// Helpers: build minimal fixtures
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
// Merge-to-deploy lag
// ---------------------------------------------------------------------------

describe("forensicEngine", () => {
  describe("merge-to-deploy-lag", () => {
    it("detects slow merge-to-deploy pipeline", () => {
      const events: EvidenceEvent[] = [
        {
          type: "PullRequestMerged",
          at: "2024-01-01T10:00:00Z",
          prNumber: 1,
          title: "feat: add auth",
          labels: [],
          openedAt: "2024-01-01T08:00:00Z",
        },
        {
          type: "DeploymentStatusObserved",
          at: "2024-01-04T10:00:00Z",
          deploymentId: 1,
          state: "success",
          environment: "production",
        },
        {
          type: "PullRequestMerged",
          at: "2024-01-05T10:00:00Z",
          prNumber: 2,
          title: "fix: login bug",
          labels: [],
          openedAt: "2024-01-05T08:00:00Z",
        },
        {
          type: "DeploymentStatusObserved",
          at: "2024-01-08T10:00:00Z",
          deploymentId: 2,
          state: "success",
          environment: "production",
        },
        {
          type: "PullRequestMerged",
          at: "2024-01-10T10:00:00Z",
          prNumber: 3,
          title: "chore: deps",
          labels: [],
          openedAt: "2024-01-10T08:00:00Z",
        },
        {
          type: "DeploymentStatusObserved",
          at: "2024-01-13T10:00:00Z",
          deploymentId: 3,
          state: "success",
          environment: "production",
        },
      ];

      const signals = computeForensicSignals(events, makeDefaultMetrics());
      const lag = signals.find((s) => s.id === "merge-to-deploy-lag");
      expect(lag).toBeDefined();
      expect(lag!.metric).toBe(72); // ~3 days = 72h
    });

    it("does not trigger when lag is under threshold", () => {
      const events: EvidenceEvent[] = [
        {
          type: "PullRequestMerged",
          at: "2024-01-01T10:00:00Z",
          prNumber: 1,
          title: "feat: x",
          labels: [],
          openedAt: "2024-01-01T08:00:00Z",
        },
        {
          type: "DeploymentStatusObserved",
          at: "2024-01-01T14:00:00Z",
          deploymentId: 1,
          state: "success",
          environment: "production",
        },
        {
          type: "PullRequestMerged",
          at: "2024-01-02T10:00:00Z",
          prNumber: 2,
          title: "feat: y",
          labels: [],
          openedAt: "2024-01-02T08:00:00Z",
        },
        {
          type: "DeploymentStatusObserved",
          at: "2024-01-02T14:00:00Z",
          deploymentId: 2,
          state: "success",
          environment: "production",
        },
      ];

      const signals = computeForensicSignals(events, makeDefaultMetrics());
      expect(signals.find((s) => s.id === "merge-to-deploy-lag")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Deploy drought
  // ---------------------------------------------------------------------------

  describe("deploy-drought", () => {
    it("detects extended deployment drought", () => {
      const events: EvidenceEvent[] = [
        {
          type: "DeploymentObserved",
          at: "2024-01-01T10:00:00Z",
          deploymentId: 1,
          environment: "production",
          ref: "main",
          sha: "abc",
        },
        {
          type: "DeploymentObserved",
          at: "2024-02-01T10:00:00Z",
          deploymentId: 2,
          environment: "production",
          ref: "main",
          sha: "def",
        },
      ];

      const signals = computeForensicSignals(events, makeDefaultMetrics());
      const drought = signals.find((s) => s.id === "deploy-drought");
      expect(drought).toBeDefined();
      expect(drought!.metric).toBe(31); // ~31 day gap
      expect(drought!.severity).toBe("critical");
    });

    it("does not trigger for frequent deployments", () => {
      const events: EvidenceEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push({
          type: "DeploymentObserved",
          at: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
          deploymentId: i,
          environment: "production",
          ref: "main",
          sha: `sha${i}`,
        });
      }

      const signals = computeForensicSignals(events, makeDefaultMetrics());
      expect(signals.find((s) => s.id === "deploy-drought")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Recovery asymmetry
  // ---------------------------------------------------------------------------

  describe("recovery-asymmetry", () => {
    it("detects when recovery is much slower than shipping", () => {
      const metrics = makeDefaultMetrics();
      metrics.failedDeploymentRecoveryTime = makeMetricResult(
        { medianHours: 48, p75Hours: 72, sampleSize: 5 },
        "Medium",
        "high",
      );
      metrics.changeLeadTime = makeMetricResult(
        {
          commitToDeployMedianHours: 4,
          prFlowMedianHours: 3,
          primarySignal: "commit_to_deploy" as const,
        },
        "Elite",
        "high",
      );

      const signals = computeForensicSignals([], metrics);
      const asymmetry = signals.find((s) => s.id === "recovery-asymmetry");
      expect(asymmetry).toBeDefined();
      expect(asymmetry!.metric).toBe(12); // 48/4 = 12×
      expect(asymmetry!.severity).toBe("critical"); // >10× = critical
    });

    it("does not trigger when recovery is proportional to lead time", () => {
      const metrics = makeDefaultMetrics();
      metrics.failedDeploymentRecoveryTime = makeMetricResult(
        { medianHours: 6, p75Hours: 10, sampleSize: 5 },
        "High",
        "high",
      );
      metrics.changeLeadTime = makeMetricResult(
        {
          commitToDeployMedianHours: 4,
          prFlowMedianHours: 3,
          primarySignal: "commit_to_deploy" as const,
        },
        "Elite",
        "high",
      );

      const signals = computeForensicSignals([], metrics);
      expect(signals.find((s) => s.id === "recovery-asymmetry")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Flaky pipeline
  // ---------------------------------------------------------------------------

  describe("flaky-pipeline", () => {
    it("detects oscillating pass/fail patterns", () => {
      const events: EvidenceEvent[] = [];
      const conclusions = [
        "success",
        "failure",
        "success",
        "failure",
        "success",
        "failure",
        "success",
        "failure",
        "success",
        "failure",
        "success",
      ];
      for (let i = 0; i < conclusions.length; i++) {
        events.push({
          type: "WorkflowRunObserved",
          at: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
          runId: i,
          workflowName: "CI",
          event: "push",
          status: "completed",
          conclusion: conclusions[i],
          headSha: `sha${i}`,
        });
      }

      const signals = computeForensicSignals(events, makeDefaultMetrics());
      const flaky = signals.find((s) => s.id === "flaky-pipeline");
      expect(flaky).toBeDefined();
    });

    it("does not trigger for stable pipelines", () => {
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
      expect(signals.find((s) => s.id === "flaky-pipeline")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Empty / minimal events
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    it("returns empty array for no events", () => {
      const signals = computeForensicSignals([], makeDefaultMetrics());
      expect(signals).toEqual([]);
    });

    it("sorts signals by severity (critical first)", () => {
      const metrics = makeDefaultMetrics();
      // Force recovery asymmetry (critical: >10×)
      metrics.failedDeploymentRecoveryTime = makeMetricResult(
        { medianHours: 100, p75Hours: 150, sampleSize: 5 },
        "Low",
        "high",
      );
      metrics.changeLeadTime = makeMetricResult(
        {
          commitToDeployMedianHours: 4,
          prFlowMedianHours: 3,
          primarySignal: "commit_to_deploy" as const,
        },
        "Elite",
        "high",
      );

      // Also add a deploy drought (critical)
      const events: EvidenceEvent[] = [
        {
          type: "DeploymentObserved",
          at: "2024-01-01T10:00:00Z",
          deploymentId: 1,
          environment: "production",
          ref: "main",
          sha: "abc",
        },
        {
          type: "DeploymentObserved",
          at: "2024-03-01T10:00:00Z",
          deploymentId: 2,
          environment: "production",
          ref: "main",
          sha: "def",
        },
      ];

      const signals = computeForensicSignals(events, metrics);
      const criticals = signals.filter((s) => s.severity === "critical");
      expect(criticals.length).toBeGreaterThanOrEqual(1);
      // All critical signals should come before warnings
      const firstWarning = signals.findIndex((s) => s.severity === "warning");
      const lastCritical =
        signals.length - 1 - [...signals].reverse().findIndex((s) => s.severity === "critical");
      if (firstWarning >= 0 && lastCritical >= 0) {
        expect(lastCritical).toBeLessThan(firstWarning);
      }
    });
  });
});
