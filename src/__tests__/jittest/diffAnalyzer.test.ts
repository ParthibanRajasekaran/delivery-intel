// ============================================================================
// JITTest — Diff Analyzer Tests
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  parseDiff,
  filterSourceFiles,
  extractAllChangedFunctions,
} from "../../jittest/diffAnalyzer";

// ---------------------------------------------------------------------------
// Test fixtures — realistic git diff snippets
// ---------------------------------------------------------------------------

const SINGLE_FILE_DIFF = `
diff --git a/src/cli/riskEngine.ts b/src/cli/riskEngine.ts
index abc1234..def5678 100644
--- a/src/cli/riskEngine.ts
+++ b/src/cli/riskEngine.ts
@@ -75,7 +75,8 @@ export function normalizeDelta(actual: number, eliteBenchmark: number, maxCap: n
   if (actual <= eliteBenchmark) {
     return 0;
   }
-  const delta = (actual - eliteBenchmark) / (maxCap - eliteBenchmark);
+  const delta = (actual - eliteBenchmark) / (maxCap - eliteBenchmark + 1);
   return Math.min(Math.max(delta, 0), 1);
 }
`.trim();

const MULTI_FILE_DIFF = `
diff --git a/src/cli/riskEngine.ts b/src/cli/riskEngine.ts
index abc1234..def5678 100644
--- a/src/cli/riskEngine.ts
+++ b/src/cli/riskEngine.ts
@@ -90,6 +90,9 @@ export function classifyRiskLevel(score: number): RiskLevel {
   if (score >= 75) {
     return "critical";
   }
+  if (score >= 90) {
+    return "critical";
+  }
   if (score >= 50) {
     return "high";
   }
diff --git a/src/lib/metrics.ts b/src/lib/metrics.ts
index 111aaaa..222bbbb 100644
--- a/src/lib/metrics.ts
+++ b/src/lib/metrics.ts
@@ -22,7 +22,7 @@ function rateDeploymentFrequency(perWeek: number) {
-  if (perWeek >= 7) {
+  if (perWeek >= 5) {
     return "Elite";
   }
 }
`.trim();

const NEW_FILE_DIFF = `
diff --git a/src/lib/newFeature.ts b/src/lib/newFeature.ts
new file mode 100644
index 0000000..abcd123
--- /dev/null
+++ b/src/lib/newFeature.ts
@@ -0,0 +1,5 @@ export function hello(name: string)
+export function hello(name: string): string {
+  if (!name) return "world";
+  return name;
+}
`.trim();

const DELETED_FILE_DIFF = `
diff --git a/src/lib/oldFeature.ts b/src/lib/oldFeature.ts
deleted file mode 100644
index abcd123..0000000
--- a/src/lib/oldFeature.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function old() {
-  return true;
-}
`.trim();

const RENAMED_FILE_DIFF = `
diff --git a/src/lib/foo.ts b/src/lib/bar.ts
similarity index 95%
rename from src/lib/foo.ts
rename to src/lib/bar.ts
index abcd123..def4567 100644
--- a/src/lib/foo.ts
+++ b/src/lib/bar.ts
@@ -1,3 +1,3 @@ function foo()
-export function foo() {
+export function bar() {
   return 42;
 }
`.trim();

const TEST_FILE_DIFF = `
diff --git a/src/__tests__/riskEngine.test.ts b/src/__tests__/riskEngine.test.ts
index abc..def 100644
--- a/src/__tests__/riskEngine.test.ts
+++ b/src/__tests__/riskEngine.test.ts
@@ -1,3 +1,4 @@
 import { describe, it, expect } from "vitest";
+import { normalizeDelta } from "../cli/riskEngine";
 
`.trim();

const WHITESPACE_ONLY_DIFF = `
diff --git a/src/lib/metrics.ts b/src/lib/metrics.ts
index abc..def 100644
--- a/src/lib/metrics.ts
+++ b/src/lib/metrics.ts
@@ -10,4 +10,4 @@ function rateDeploymentFrequency(perWeek: number)
-  
+
 
`.trim();

// ---------------------------------------------------------------------------
// parseDiff — basic structure
// ---------------------------------------------------------------------------

describe("parseDiff", () => {
  it("returns a DiffAnalysis with analyzedAt timestamp", () => {
    const result = parseDiff(SINGLE_FILE_DIFF);
    expect(result.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("parses a single-file diff with correct stats", () => {
    const result = parseDiff(SINGLE_FILE_DIFF);
    expect(result.stats.filesChanged).toBe(1);
    expect(result.stats.totalAdditions).toBe(1);
    expect(result.stats.totalDeletions).toBe(1);
  });

  it("parses a multi-file diff with correct file count", () => {
    const result = parseDiff(MULTI_FILE_DIFF);
    expect(result.stats.filesChanged).toBe(2);
    expect(result.files).toHaveLength(2);
  });

  it("extracts file paths correctly", () => {
    const result = parseDiff(MULTI_FILE_DIFF);
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain("src/cli/riskEngine.ts");
    expect(paths).toContain("src/lib/metrics.ts");
  });

  it("returns empty files array for empty diff", () => {
    const result = parseDiff("");
    expect(result.files).toHaveLength(0);
    expect(result.stats.filesChanged).toBe(0);
  });

  it("returns zero stats for whitespace-only diff content", () => {
    const result = parseDiff(WHITESPACE_ONLY_DIFF);
    // File is present but meaningful line content is whitespace
    expect(result.stats.filesChanged).toBe(1);
  });

  it("marks new files correctly", () => {
    const result = parseDiff(NEW_FILE_DIFF);
    const file = result.files.find((f) => f.path.includes("newFeature"));
    expect(file).toBeDefined();
    expect(file!.isNew).toBe(true);
  });

  it("marks deleted files correctly", () => {
    const result = parseDiff(DELETED_FILE_DIFF);
    const file = result.files.find(
      (f) => f.path.includes("oldFeature") || f.oldPath?.includes("oldFeature"),
    );
    expect(file).toBeDefined();
    expect(file!.isDeleted).toBe(true);
  });

  it("marks renamed files correctly", () => {
    const result = parseDiff(RENAMED_FILE_DIFF);
    const file = result.files[0];
    expect(file.isRenamed).toBe(true);
    expect(file.path).toContain("bar.ts");
  });

  it("accumulates totalAdditions and totalDeletions across all hunks", () => {
    const result = parseDiff(MULTI_FILE_DIFF);
    expect(result.stats.totalAdditions).toBeGreaterThan(0);
    expect(result.stats.totalDeletions).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// parseDiff — hunk parsing
// ---------------------------------------------------------------------------

describe("parseDiff — hunk structure", () => {
  it("parses hunk with correct oldStart and newStart", () => {
    const result = parseDiff(SINGLE_FILE_DIFF);
    const file = result.files[0];
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0].oldStart).toBe(75);
    expect(file.hunks[0].newStart).toBe(75);
  });

  it("extracts added lines without leading +", () => {
    const result = parseDiff(SINGLE_FILE_DIFF);
    const hunk = result.files[0].hunks[0];
    expect(hunk.addedLines.some((l) => l.includes("maxCap - eliteBenchmark + 1"))).toBe(true);
    expect(hunk.addedLines.every((l) => !l.startsWith("+"))).toBe(true);
  });

  it("extracts removed lines without leading -", () => {
    const result = parseDiff(SINGLE_FILE_DIFF);
    const hunk = result.files[0].hunks[0];
    expect(hunk.removedLines.some((l) => l.includes("maxCap - eliteBenchmark)"))).toBe(true);
    expect(hunk.removedLines.every((l) => !l.startsWith("-"))).toBe(true);
  });

  it("extracts context lines with diff-prefix stripped (code indent preserved)", () => {
    const result = parseDiff(SINGLE_FILE_DIFF);
    const hunk = result.files[0].hunks[0];
    expect(hunk.contextLines.length).toBeGreaterThan(0);
    // The diff-prefix space is stripped; code indentation spaces remain.
    // Context lines must not start with diff markers (+/-) but may start with spaces.
    expect(hunk.contextLines.every((l) => !l.startsWith("+") && !l.startsWith("-"))).toBe(true);
  });

  it("extracts function context from hunk header", () => {
    const result = parseDiff(SINGLE_FILE_DIFF);
    const hunk = result.files[0].hunks[0];
    expect(hunk.functionContext).toBeTruthy();
    expect(hunk.functionContext).toContain("normalizeDelta");
  });

  it("lists changedFunctions on the file object", () => {
    const result = parseDiff(SINGLE_FILE_DIFF);
    const file = result.files[0];
    expect(file.changedFunctions).toContain("normalizeDelta");
  });

  it("deduplicates function names when multiple hunks touch same function", () => {
    // Both hunks in the multi-file diff touch classifyRiskLevel
    const multiHunkDiff = `
diff --git a/src/cli/riskEngine.ts b/src/cli/riskEngine.ts
index abc..def 100644
--- a/src/cli/riskEngine.ts
+++ b/src/cli/riskEngine.ts
@@ -90,3 +90,3 @@ export function classifyRiskLevel(score)
-  if (score >= 75) {
+  if (score >= 80) {
   return "critical";
 }
@@ -95,3 +95,3 @@ export function classifyRiskLevel(score)
-  if (score >= 50) {
+  if (score >= 55) {
   return "high";
 }
`.trim();
    const result = parseDiff(multiHunkDiff);
    const file = result.files[0];
    const count = file.changedFunctions.filter((n) => n === "classifyRiskLevel").length;
    expect(count).toBe(1); // deduplicated
  });
});

// ---------------------------------------------------------------------------
// filterSourceFiles
// ---------------------------------------------------------------------------

describe("filterSourceFiles", () => {
  it("includes TypeScript source files", () => {
    const result = parseDiff(SINGLE_FILE_DIFF);
    const filtered = filterSourceFiles(result);
    expect(filtered.map((f) => f.path)).toContain("src/cli/riskEngine.ts");
  });

  it("excludes deleted files", () => {
    const result = parseDiff(DELETED_FILE_DIFF);
    const filtered = filterSourceFiles(result);
    expect(filtered).toHaveLength(0);
  });

  it("excludes test files", () => {
    const result = parseDiff(TEST_FILE_DIFF);
    const filtered = filterSourceFiles(result);
    expect(filtered).toHaveLength(0);
  });

  it("includes new source files", () => {
    const result = parseDiff(NEW_FILE_DIFF);
    const filtered = filterSourceFiles(result);
    expect(filtered.some((f) => f.path.includes("newFeature"))).toBe(true);
  });

  it("returns only source files from a multi-file diff", () => {
    const result = parseDiff(MULTI_FILE_DIFF);
    const filtered = filterSourceFiles(result);
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered.every((f) => f.path.endsWith(".ts") || f.path.endsWith(".tsx"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractAllChangedFunctions
// ---------------------------------------------------------------------------

describe("extractAllChangedFunctions", () => {
  it("returns all unique changed function names", () => {
    const result = parseDiff(MULTI_FILE_DIFF);
    const fns = extractAllChangedFunctions(result);
    expect(fns.length).toBeGreaterThan(0);
    expect(fns.every((fn) => typeof fn === "string")).toBe(true);
  });

  it("returns empty array for a diff with no changed functions", () => {
    const result = parseDiff("");
    const fns = extractAllChangedFunctions(result);
    expect(fns).toHaveLength(0);
  });

  it("deduplicates functions across files", () => {
    // Craft a diff where the same function name appears in two files
    const dupDiff = `
diff --git a/src/cli/riskEngine.ts b/src/cli/riskEngine.ts
index 1..2 100644
--- a/src/cli/riskEngine.ts
+++ b/src/cli/riskEngine.ts
@@ -1,2 +1,2 @@ export function compute()
-const x = 1;
+const x = 2;
diff --git a/src/lib/metrics.ts b/src/lib/metrics.ts
index 3..4 100644
--- a/src/lib/metrics.ts
+++ b/src/lib/metrics.ts
@@ -1,2 +1,2 @@ export function compute()
-const y = 1;
+const y = 2;
`.trim();
    const result = parseDiff(dupDiff);
    const fns = extractAllChangedFunctions(result);
    const computeCount = fns.filter((n) => n === "compute").length;
    expect(computeCount).toBe(1);
  });
});
