// ============================================================================
// JITTest — Runner Integration Tests
// ============================================================================
import { describe, it, expect } from "vitest";
import { runJITTestPipeline, getDiffFromGit } from "../../jittest/runner";
import type { LLMAssessor } from "../../jittest/assessors";
import type { CatchingTest } from "../../jittest/catchingTestGenerator";
import type { AssessmentResult } from "../../jittest/assessors";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A realistic diff with one meaningful change. */
const MEANINGFUL_DIFF = `
diff --git a/src/cli/riskEngine.ts b/src/cli/riskEngine.ts
index abc..def 100644
--- a/src/cli/riskEngine.ts
+++ b/src/cli/riskEngine.ts
@@ -78,4 +78,4 @@ export function normalizeDelta(actual: number, eliteBenchmark: number, maxCap: n
-  const delta = (actual - eliteBenchmark) / (maxCap - eliteBenchmark);
+  const delta = (actual - eliteBenchmark) / (maxCap - eliteBenchmark + 1);
   return Math.min(Math.max(delta, 0), 1);
 }
`.trim();

/** Two-file diff exercising multi-file analysis. */
const MULTI_FILE_DIFF = `
diff --git a/src/cli/riskEngine.ts b/src/cli/riskEngine.ts
index abc1..def1 100644
--- a/src/cli/riskEngine.ts
+++ b/src/cli/riskEngine.ts
@@ -90,4 +90,4 @@ export function classifyRiskLevel(score: number): RiskLevel {
-  if (score >= 75) {
+  if (score >= 80) {
     return "critical";
   }
 }
diff --git a/src/lib/metrics.ts b/src/lib/metrics.ts
index abc2..def2 100644
--- a/src/lib/metrics.ts
+++ b/src/lib/metrics.ts
@@ -22,4 +22,4 @@ function rateDeploymentFrequency(perWeek: number)
-  if (perWeek >= 7) {
+  if (perWeek >= 5) {
     return "Elite";
   }
`.trim();

/** An empty diff — should produce an empty report. */
const EMPTY_DIFF = "";

/** A diff touching only test files — zero catching tests should be generated. */
const TEST_ONLY_DIFF = `
diff --git a/src/__tests__/riskEngine.test.ts b/src/__tests__/riskEngine.test.ts
index abc..def 100644
--- a/src/__tests__/riskEngine.test.ts
+++ b/src/__tests__/riskEngine.test.ts
@@ -1,2 +1,3 @@
 import { describe } from "vitest";
+// new comment
`.trim();

// ---------------------------------------------------------------------------
// runJITTestPipeline — empty diff
// ---------------------------------------------------------------------------

describe("runJITTestPipeline — empty diff", () => {
  it("returns a report with zero generated tests", async () => {
    const report = await runJITTestPipeline({ rawDiff: EMPTY_DIFF });
    expect(report.totalGenerated).toBe(0);
  });

  it("returns empty candidateCatches for empty diff", async () => {
    const report = await runJITTestPipeline({ rawDiff: EMPTY_DIFF });
    expect(report.candidateCatches).toHaveLength(0);
  });

  it("includes a timestamp", async () => {
    const report = await runJITTestPipeline({ rawDiff: EMPTY_DIFF });
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes a markdownSummary", async () => {
    const report = await runJITTestPipeline({ rawDiff: EMPTY_DIFF });
    expect(report.markdownSummary).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// runJITTestPipeline — meaningful diff
// ---------------------------------------------------------------------------

describe("runJITTestPipeline — meaningful diff", () => {
  it("generates at least one catching test", async () => {
    const report = await runJITTestPipeline({ rawDiff: MEANINGFUL_DIFF });
    expect(report.totalGenerated).toBeGreaterThan(0);
  });

  it("returns diffStats reflecting the parsed diff", async () => {
    const report = await runJITTestPipeline({ rawDiff: MEANINGFUL_DIFF });
    expect(report.diffStats.filesChanged).toBe(1);
    expect(report.diffStats.totalAdditions).toBeGreaterThan(0);
    expect(report.diffStats.totalDeletions).toBeGreaterThan(0);
  });

  it("all generated count equals catches + FPs + needs_review", async () => {
    const report = await runJITTestPipeline({ rawDiff: MEANINGFUL_DIFF });
    const total =
      report.candidateCatches.length +
      report.falsePositives.length +
      report.needsHumanReview.length;
    expect(total).toBe(report.totalGenerated);
  });

  it("fpReductionRate is between 0 and 1", async () => {
    const report = await runJITTestPipeline({ rawDiff: MEANINGFUL_DIFF });
    expect(report.fpReductionRate).toBeGreaterThanOrEqual(0);
    expect(report.fpReductionRate).toBeLessThanOrEqual(1);
  });

  it("markdownSummary contains expected section headers", async () => {
    const report = await runJITTestPipeline({ rawDiff: MEANINGFUL_DIFF });
    expect(report.markdownSummary).toContain("JITTest");
    expect(report.markdownSummary).toContain("Diff Stats");
    expect(report.markdownSummary).toContain("Assessment Summary");
  });

  it("markdownSummary contains the arXiv reference", async () => {
    const report = await runJITTestPipeline({ rawDiff: MEANINGFUL_DIFF });
    expect(report.markdownSummary).toContain("arXiv:2601.22832");
  });
});

// ---------------------------------------------------------------------------
// runJITTestPipeline — multi-file diff
// ---------------------------------------------------------------------------

describe("runJITTestPipeline — multi-file diff", () => {
  it("reflects multiple changed files in diffStats", async () => {
    const report = await runJITTestPipeline({ rawDiff: MULTI_FILE_DIFF });
    expect(report.diffStats.filesChanged).toBe(2);
  });

  it("generates tests from multiple source files", async () => {
    const report = await runJITTestPipeline({ rawDiff: MULTI_FILE_DIFF });
    expect(report.totalGenerated).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// runJITTestPipeline — test-only diff
// ---------------------------------------------------------------------------

describe("runJITTestPipeline — test-only diff", () => {
  it("generates zero tests (test files are excluded)", async () => {
    const report = await runJITTestPipeline({ rawDiff: TEST_ONLY_DIFF });
    expect(report.totalGenerated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runJITTestPipeline — custom LLM assessor
// ---------------------------------------------------------------------------

describe("runJITTestPipeline — custom LLM assessor", () => {
  it("LLM assessor is invoked for candidate catches", async () => {
    let invoked = 0;
    const customLLM: LLMAssessor = {
      async assess(_test: CatchingTest, ruleResult: AssessmentResult) {
        invoked++;
        return { ...ruleResult, producedBy: "llm_based" as const };
      },
    };
    const report = await runJITTestPipeline({
      rawDiff: MEANINGFUL_DIFF,
      llmAssessor: customLLM,
    });
    // LLM should have been called for non-FP tests
    const nonFpCount = report.totalGenerated - report.falsePositives.length;
    expect(invoked).toBe(nonFpCount);
  });

  it("LLM assessor can override verdict to needs_review", async () => {
    const downgraderLLM: LLMAssessor = {
      async assess(_test: CatchingTest, ruleResult: AssessmentResult) {
        return {
          ...ruleResult,
          verdict: "needs_review" as const,
          producedBy: "llm_based" as const,
        };
      },
    };
    const report = await runJITTestPipeline({
      rawDiff: MEANINGFUL_DIFF,
      llmAssessor: downgraderLLM,
    });
    // No LLM-touched test should be a candidate_catch after downgrade
    expect(report.candidateCatches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runJITTestPipeline — report structure invariants
// ---------------------------------------------------------------------------

describe("runJITTestPipeline — report invariants", () => {
  it("trivialHunksSkipped is a non-negative integer", async () => {
    const report = await runJITTestPipeline({ rawDiff: MEANINGFUL_DIFF });
    expect(report.trivialHunksSkipped).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(report.trivialHunksSkipped)).toBe(true);
  });

  it("each candidateCatch has test and assessment", async () => {
    const report = await runJITTestPipeline({ rawDiff: MEANINGFUL_DIFF });
    report.candidateCatches.forEach((cc) => {
      expect(cc).toHaveProperty("test");
      expect(cc).toHaveProperty("assessment");
      expect(cc.assessment.verdict).toBe("candidate_catch");
    });
  });

  it("each falsePositive has verdict false_positive", async () => {
    const report = await runJITTestPipeline({ rawDiff: MEANINGFUL_DIFF });
    report.falsePositives.forEach((fp) => {
      expect(fp.assessment.verdict).toBe("false_positive");
    });
  });
});

// ---------------------------------------------------------------------------
// getDiffFromGit — error handling
// ---------------------------------------------------------------------------

describe("getDiffFromGit", () => {
  it("throws a descriptive error when git command fails", () => {
    // Use a non-existent directory to force failure
    expect(() => getDiffFromGit(undefined, "/nonexistent_directory_xyz")).toThrow(/git diff/i);
  });
});
