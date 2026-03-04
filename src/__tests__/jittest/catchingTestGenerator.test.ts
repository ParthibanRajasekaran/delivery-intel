// ============================================================================
// JITTest — Catching Test Generator Tests
// ============================================================================
import { describe, it, expect } from "vitest";
import { generateCatchingTests, type GenerationResult } from "../../jittest/catchingTestGenerator";
import { parseDiff, filterSourceFiles } from "../../jittest/diffAnalyzer";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Diff that changes a numeric comparison boundary — should trigger boundary_condition. */
const BOUNDARY_DIFF = `
diff --git a/src/cli/riskEngine.ts b/src/cli/riskEngine.ts
index abc..def 100644
--- a/src/cli/riskEngine.ts
+++ b/src/cli/riskEngine.ts
@@ -90,5 +90,5 @@ export function classifyRiskLevel(score: number): RiskLevel {
-  if (score >= 75) {
+  if (score >= 80) {
     return "critical";
   }
 }
`.trim();

/** Diff that removes a null check — should trigger null_check. */
const NULL_CHECK_DIFF = `
diff --git a/src/lib/suggestions.ts b/src/lib/suggestions.ts
index abc..def 100644
--- a/src/lib/suggestions.ts
+++ b/src/lib/suggestions.ts
@@ -10,5 +10,4 @@ export function generateSuggestions(dora, vulns) {
-  if (dora === null || dora === undefined) return [];
   const suggestions = [];
   return suggestions;
 }
`.trim();

/** Diff that changes an arithmetic expression — should trigger arithmetic. */
const ARITHMETIC_DIFF = `
diff --git a/src/cli/riskEngine.ts b/src/cli/riskEngine.ts
index abc..def 100644
--- a/src/cli/riskEngine.ts
+++ b/src/cli/riskEngine.ts
@@ -150,4 +150,4 @@ export function computeRiskScore(input: RiskInput) {
-  const score = Math.round((cycleContrib + failureContrib) * 100);
+  const score = Math.round((cycleContrib * failureContrib) * 100);
   return Math.min(100, Math.max(0, score));
 }
`.trim();

/**
 * Diff that changes a control-flow branch without numeric literals so
 * boundary_condition patterns do not fire first.
 */
const CONTROL_FLOW_DIFF = `
diff --git a/src/cli/hygieneCheck.ts b/src/cli/hygieneCheck.ts
index abc..def 100644
--- a/src/cli/hygieneCheck.ts
+++ b/src/cli/hygieneCheck.ts
@@ -55,4 +55,4 @@ export function checkCoverage(pct: number | undefined): HygieneCheck {
-  if (hasError) {
+  if (!hasError) {
     return { name: "Coverage", status: "fail", detail: "failed" };
   }
 }
`.trim();

/** A whitespace-only diff — all hunks should be trivial → zero tests generated. */
const WHITESPACE_DIFF = `
diff --git a/src/lib/metrics.ts b/src/lib/metrics.ts
index abc..def 100644
--- a/src/lib/metrics.ts
+++ b/src/lib/metrics.ts
@@ -10,3 +10,3 @@ function rateDeploymentFrequency(perWeek)
-  
+
 
`.trim();

/** Diff on a test file — should be excluded by filterSourceFiles. */
const TEST_ONLY_DIFF = `
diff --git a/src/__tests__/metrics.test.ts b/src/__tests__/metrics.test.ts
index abc..def 100644
--- a/src/__tests__/metrics.test.ts
+++ b/src/__tests__/metrics.test.ts
@@ -1,2 +1,3 @@ describe("metrics")
 import { describe } from "vitest";
+// added comment
`.trim();

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function genFromDiff(rawDiff: string): GenerationResult {
  const analysis = parseDiff(rawDiff);
  const sourceFiles = filterSourceFiles(analysis);
  return generateCatchingTests(sourceFiles);
}

// ---------------------------------------------------------------------------
// generateCatchingTests — basic
// ---------------------------------------------------------------------------

describe("generateCatchingTests", () => {
  it("returns a GenerationResult with generatedAt timestamp", () => {
    const result = genFromDiff(BOUNDARY_DIFF);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("generates at least one test from a meaningful diff", () => {
    const result = genFromDiff(BOUNDARY_DIFF);
    expect(result.tests.length).toBeGreaterThan(0);
  });

  it("generates zero tests for an empty diff", () => {
    const result = genFromDiff("");
    expect(result.tests).toHaveLength(0);
    expect(result.skippedHunks).toBe(0);
  });

  it("skips trivial (whitespace-only) hunks", () => {
    const result = genFromDiff(WHITESPACE_DIFF);
    expect(result.skippedHunks).toBeGreaterThan(0);
  });

  it("generates zero tests for test-file-only diffs (filtered by sourceFiles)", () => {
    const result = genFromDiff(TEST_ONLY_DIFF);
    expect(result.tests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CatchingTest shape validation
// ---------------------------------------------------------------------------

describe("CatchingTest shape", () => {
  it("each test has a non-empty id", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    tests.forEach((t) => expect(t.id).toBeTruthy());
  });

  it("each test has a non-empty targetFile", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    tests.forEach((t) => expect(t.targetFile).toBeTruthy());
  });

  it("each test has a non-empty importPath", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    tests.forEach((t) => {
      expect(t.importPath).toBeTruthy();
      expect(t.importPath.length).toBeGreaterThan(1);
    });
  });

  it("each test has non-empty testCode containing describe and expect", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    tests.forEach((t) => {
      expect(t.testCode).toContain("describe");
      expect(t.testCode).toContain("expect");
    });
  });

  it("each test has a rationale string", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    tests.forEach((t) => expect(t.rationale.length).toBeGreaterThan(10));
  });

  it("isExpectedToFail is always true (catching tests are meant to fail on bugs)", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    tests.forEach((t) => expect(t.isExpectedToFail).toBe(true));
  });

  it("diffLines.added mirrors the diff additions", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    expect(tests[0].diffLines.added.length).toBeGreaterThan(0);
  });

  it("test IDs are unique across the result", () => {
    const analysis = parseDiff(ARITHMETIC_DIFF + "\n" + CONTROL_FLOW_DIFF);
    const src = filterSourceFiles(analysis);
    const { tests } = generateCatchingTests(src);
    const ids = tests.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Change-category detection
// ---------------------------------------------------------------------------

describe("change category detection", () => {
  it("detects boundary_condition for numeric comparison changes", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    const hasBoundary = tests.some((t) => t.category === "boundary_condition");
    expect(hasBoundary).toBe(true);
  });

  it("detects null_check for null guard removal", () => {
    const { tests } = genFromDiff(NULL_CHECK_DIFF);
    const hasNull = tests.some((t) => t.category === "null_check");
    expect(hasNull).toBe(true);
  });

  it("detects arithmetic for operator changes", () => {
    const { tests } = genFromDiff(ARITHMETIC_DIFF);
    const hasArith = tests.some((t) => t.category === "arithmetic");
    expect(hasArith).toBe(true);
  });

  it("detects control_flow for if-condition changes", () => {
    const { tests } = genFromDiff(CONTROL_FLOW_DIFF);
    const hasCF = tests.some((t) => t.category === "control_flow");
    expect(hasCF).toBe(true);
  });

  it("generates testCode containing boundary-specific comment for boundary diffs", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    const boundaryTest = tests.find((t) => t.category === "boundary_condition");
    expect(boundaryTest?.testCode).toContain("boundary");
  });

  it("generates testCode containing null-specific comment for null_check diffs", () => {
    const { tests } = genFromDiff(NULL_CHECK_DIFF);
    const nullTest = tests.find((t) => t.category === "null_check");
    expect(nullTest?.testCode).toContain("null");
  });
});

// ---------------------------------------------------------------------------
// Import path derivation
// ---------------------------------------------------------------------------

describe("importPath derivation", () => {
  it("converts src/ prefix to @/ alias", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    tests.forEach((t) => expect(t.importPath.startsWith("@/")).toBe(true));
  });

  it("strips the file extension from the import path", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    tests.forEach((t) => {
      expect(t.importPath).not.toMatch(/\.(ts|tsx|js|jsx)$/);
    });
  });
});

// ---------------------------------------------------------------------------
// Rationale
// ---------------------------------------------------------------------------

describe("rationale content", () => {
  it("rationale mentions the target function name", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    tests.forEach((t) => {
      expect(t.rationale).toContain(`\`${t.targetFunction}\``);
    });
  });

  it("rationale mentions catching intent", () => {
    const { tests } = genFromDiff(BOUNDARY_DIFF);
    tests.forEach((t) => {
      expect(t.rationale.toLowerCase()).toContain("catching");
    });
  });
});
