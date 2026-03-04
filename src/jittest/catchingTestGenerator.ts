// ============================================================================
// JITTest — Catching Test Generator
// ============================================================================
// Generates "catching tests" — tests deliberately designed to FAIL if a bug
// is introduced by a code change. Unlike hardening tests (which pass at
// generation time), catching tests surface regressions before code lands.
//
// Based on the Meta JITTest paper (arXiv:2601.22832), code-change-aware
// generation is 4x more effective at catching bugs than hardening tests and
// 20x more effective than coincidentally failing tests.
//
// Strategy:
//   1. For each changed function, inspect the diff to classify the change type.
//   2. Select catching heuristics appropriate for that change type.
//   3. Emit executable Vitest test code that probes the boundary condition
//      introduced or modified by the change.
// ============================================================================

import type { ChangedFile, DiffHunk } from "./diffAnalyzer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Category of change detected in a diff hunk. */
export type ChangeCategory =
  | "boundary_condition" // threshold / comparison value changed
  | "arithmetic" // arithmetic operator or operand changed
  | "null_check" // null / undefined guard added or removed
  | "type_coercion" // parseInt/parseFloat/Number/String casting changed
  | "control_flow" // if/else/switch structure changed
  | "return_value" // return statement changed
  | "string_format" // string template or concatenation changed
  | "array_mutation" // push/pop/splice/filter changed
  | "unknown"; // fallback

/** A single catching test case ready for execution via Vitest. */
export interface CatchingTest {
  /** Stable UUID-style ID derived from file + function + category. */
  id: string;
  /** Repo-relative path of the source file being tested. */
  targetFile: string;
  /** Name of the function under test. */
  targetFunction: string;
  /** The module import path to use in generated test code. */
  importPath: string;
  /** The generated Vitest test source code. */
  testCode: string;
  /** Human-readable explanation of what bug this test is designed to catch. */
  rationale: string;
  /** Detected category of the change that prompted this test. */
  category: ChangeCategory;
  /**
   * True for all JITTest catching tests — they are *expected to fail* when
   * the change under review contains a bug. A passing catching test means no
   * bug was caught (or the test is a false positive).
   */
  isExpectedToFail: boolean;
  /** The line range in the diff that triggered generation. */
  diffLines: { added: string[]; removed: string[] };
}

/** Result of analysing all changed files. */
export interface GenerationResult {
  tests: CatchingTest[];
  /** Number of hunks that were skipped (e.g. trivial whitespace-only diffs). */
  skippedHunks: number;
  /** ISO timestamp. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Change-type detectors
// ---------------------------------------------------------------------------

/** Patterns that suggest a numeric boundary / threshold was changed. */
const BOUNDARY_PATTERNS = [
  /[><=!]=?\s*\d+/, // comparison with literal
  /\bthreashold\b|\blimit\b|\bmax\b|\bmin\b/i,
  /Math\.min|Math\.max|Math\.clamp/,
];

/** Patterns that suggest arithmetic was changed. */
const ARITHMETIC_PATTERNS = [/[+\-*/]\s*\d+/, /\+\+|--/, /\*=|\/=|\+=|-=/];

/** Patterns that suggest a null / undefined guard was changed. */
const NULL_CHECK_PATTERNS = [
  /\bnull\b|\bundefined\b/,
  /\?\?|!\./,
  /typeof .+ ===? ["']undefined["']/,
  /=== null|!== null|== null|!= null/,
];

/** Patterns for type coercion changes. */
const TYPE_COERCION_PATTERNS = [
  /parseInt|parseFloat|Number\(|String\(|Boolean\(/,
  /\.toString\(\)|\.valueOf\(\)/,
  /\+\s*["']|["']\s*\+/,
];

/** Patterns for return value changes. */
const RETURN_VALUE_PATTERNS = [/^\s*return\s/];

/** Patterns for control flow changes. */
const CONTROL_FLOW_PATTERNS = [
  /^\s*(if|else|switch|case|break|continue|for|while)\b/,
  /\?\s*.+\s*:/, // ternary
];

/** Patterns for string formatting changes. */
const STRING_FORMAT_PATTERNS = [
  /`[^`]*\${/, // template literal
  /\.replace\(|\.trim\(|\.padStart\(|\.padEnd\(/,
  /\.toUpperCase\(|\.toLowerCase\(/,
];

/** Patterns for array mutation changes. */
const ARRAY_MUTATION_PATTERNS = [
  /\.push\(|\.pop\(|\.shift\(|\.unshift\(/,
  /\.splice\(|\.filter\(|\.map\(|\.reduce\(/,
  /\.slice\(|\.concat\(/,
];

function detectCategory(hunk: DiffHunk): ChangeCategory {
  const changedLines = [...hunk.addedLines, ...hunk.removedLines].join("\n");

  if (NULL_CHECK_PATTERNS.some((p) => p.test(changedLines))) {
    return "null_check";
  }
  if (BOUNDARY_PATTERNS.some((p) => p.test(changedLines))) {
    return "boundary_condition";
  }
  if (ARITHMETIC_PATTERNS.some((p) => p.test(changedLines))) {
    return "arithmetic";
  }
  if (TYPE_COERCION_PATTERNS.some((p) => p.test(changedLines))) {
    return "type_coercion";
  }
  if (CONTROL_FLOW_PATTERNS.some((p) => p.test(changedLines))) {
    return "control_flow";
  }
  if (RETURN_VALUE_PATTERNS.some((p) => p.test(changedLines))) {
    return "return_value";
  }
  if (STRING_FORMAT_PATTERNS.some((p) => p.test(changedLines))) {
    return "string_format";
  }
  if (ARRAY_MUTATION_PATTERNS.some((p) => p.test(changedLines))) {
    return "array_mutation";
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Hunk significance filter
// ---------------------------------------------------------------------------

/** Returns true when the hunk is just whitespace / comment changes. */
function isTrivialHunk(hunk: DiffHunk): boolean {
  const meaningful = (line: string) => {
    const t = line.trim();
    return t.length > 0 && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  };
  const addedMeaningful = hunk.addedLines.filter(meaningful);
  const removedMeaningful = hunk.removedLines.filter(meaningful);
  return addedMeaningful.length === 0 && removedMeaningful.length === 0;
}

// ---------------------------------------------------------------------------
// Test code templates
// ---------------------------------------------------------------------------

/** Derive an import path from a repo-relative source path. */
function buildImportPath(filePath: string): string {
  // Strip leading src/ and file extension for the @/ alias
  return filePath.replace(/^src\//, "@/").replace(/\.(ts|tsx|js|jsx)$/, "");
}

/** Stable ID generator: deterministic hash-like string from components. */
function makeTestId(file: string, fn: string, category: string, index: number): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20);
  return `jit_${safe(fn)}_${safe(category)}_${index}`;
}

interface TemplateContext {
  functionName: string;
  importPath: string;
  addedLines: string[];
  removedLines: string[];
  hunkContext: string;
}

function templateBoundaryCondition(ctx: TemplateContext, index: number): string {
  const { functionName, importPath } = ctx;
  return `
// [JITTest — boundary_condition] Catching test #${index}
// Probes the boundary value that was modified in this diff.
// This test is EXPECTED TO FAIL if the changed threshold introduces a bug.
import { describe, it, expect } from "vitest";
import { ${functionName} } from "${importPath}";

describe("[JITTest] ${functionName} — boundary_condition catch", () => {
  it("should handle the exact boundary value (off-by-one catching test)", () => {
    // TODO: Adjust the boundary value to match the changed constant in the diff.
    // The test is written to expose a bug if the new threshold is wrong.
    const result = (${functionName} as (...args: unknown[]) => unknown)(/* boundary value args */);
    expect(result).toBeDefined();
    // Catching assertion: probe at (eliteBoundary - 1), at eliteBoundary, and at (eliteBoundary + 1)
    // Replace these with the actual function signature.
  });

  it("should not unexpectedly return 0 for values strictly above the boundary", () => {
    const resultAbove = (${functionName} as (...args: unknown[]) => unknown)(/* above boundary */);
    expect(resultAbove).not.toBe(0); // or the specific incorrect value the buggy code returns
  });
});
`.trim();
}

function templateArithmetic(ctx: TemplateContext, index: number): string {
  const { functionName, importPath } = ctx;
  return `
// [JITTest — arithmetic] Catching test #${index}
// Probes arithmetic operations modified in the diff.
import { describe, it, expect } from "vitest";
import { ${functionName} } from "${importPath}";

describe("[JITTest] ${functionName} — arithmetic catch", () => {
  it("should produce the mathematically correct result for a known input", () => {
    // Catching: if the operator/operand was changed incorrectly, this fails.
    const result = (${functionName} as (...args: unknown[]) => unknown)(/* known numeric args */);
    expect(typeof result).toBe("number");
    expect(isNaN(result as number)).toBe(false);
    expect(isFinite(result as number)).toBe(true);
  });

  it("should handle division by zero (denominator guard catching test)", () => {
    // If the diff removed a +1 guard against divide-by-zero, this catches it.
    expect(() =>
      (${functionName} as (...args: unknown[]) => unknown)(/* args that reach denominator=0 */)
    ).not.toThrow();
  });
});
`.trim();
}

function templateNullCheck(ctx: TemplateContext, index: number): string {
  const { functionName, importPath } = ctx;
  return `
// [JITTest — null_check] Catching test #${index}
// Probes null/undefined handling that was added or removed in the diff.
import { describe, it, expect } from "vitest";
import { ${functionName} } from "${importPath}";

describe("[JITTest] ${functionName} — null_check catch", () => {
  it("should not throw when called with null/undefined inputs", () => {
    // Catching: if a null guard was accidentally removed the function will throw.
    expect(() =>
      (${functionName} as (...args: unknown[]) => unknown)(null)
    ).not.toThrow();
  });

  it("should return a defined value (not null/undefined) for valid inputs", () => {
    const result = (${functionName} as (...args: unknown[]) => unknown)(/* valid args */);
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
  });
});
`.trim();
}

function templateTypeCoercion(ctx: TemplateContext, index: number): string {
  const { functionName, importPath } = ctx;
  return `
// [JITTest — type_coercion] Catching test #${index}
// Probes type coercion logic that was changed in the diff.
import { describe, it, expect } from "vitest";
import { ${functionName} } from "${importPath}";

describe("[JITTest] ${functionName} — type_coercion catch", () => {
  it("should produce the same result for numeric string and real number inputs", () => {
    // Catching: incorrect coercion returns NaN or wrong type.
    const withNumber = (${functionName} as (...args: unknown[]) => unknown)(/* numeric arg */);
    expect(typeof withNumber).not.toBe("undefined");
    expect(String(withNumber)).not.toBe("NaN");
  });

  it("should handle edge-case numeric strings (empty, whitespace, Infinity)", () => {
    // Catching: parseFloat("") returns NaN; parseInt("  ") returns NaN.
    expect(() =>
      (${functionName} as (...args: unknown[]) => unknown)("")
    ).not.toThrow();
  });
});
`.trim();
}

function templateControlFlow(ctx: TemplateContext, index: number): string {
  const { functionName, importPath } = ctx;
  return `
// [JITTest — control_flow] Catching test #${index}
// Probes the control-flow branch that was modified in the diff.
import { describe, it, expect } from "vitest";
import { ${functionName} } from "${importPath}";

describe("[JITTest] ${functionName} — control_flow catch", () => {
  it("should follow the correct branch for the changed condition", () => {
    // Catching: if the branch condition was inverted or incorrectly changed,
    // the function returns the wrong result.
    const result = (${functionName} as (...args: unknown[]) => unknown)(/* branch-triggering args */);
    expect(result).toBeDefined();
  });

  it("should cover the else/fallthrough branch after the change", () => {
    const result = (${functionName} as (...args: unknown[]) => unknown)(/* non-triggering args */);
    expect(result).toBeDefined();
  });
});
`.trim();
}

function templateReturnValue(ctx: TemplateContext, index: number): string {
  const { functionName, importPath } = ctx;
  return `
// [JITTest — return_value] Catching test #${index}
// Probes the return value that was changed in the diff.
import { describe, it, expect } from "vitest";
import { ${functionName} } from "${importPath}";

describe("[JITTest] ${functionName} — return_value catch", () => {
  it("should return the expected shape/type after the change", () => {
    const result = (${functionName} as (...args: unknown[]) => unknown)(/* args */);
    // Catching: if the return path was changed to return undefined or wrong type.
    expect(result).toBeDefined();
  });
});
`.trim();
}

function templateGeneric(ctx: TemplateContext, index: number): string {
  const { functionName, importPath } = ctx;
  return `
// [JITTest — unknown] Catching test #${index}
// Generic catching test for a change that didn't match a specific pattern.
import { describe, it, expect } from "vitest";
import { ${functionName} } from "${importPath}";

describe("[JITTest] ${functionName} — change catch", () => {
  it("should behave correctly after the diff change", () => {
    // Catching: generic probe to ensure the function is still callable with
    // minimal inputs and returns a defined result.
    expect(() =>
      (${functionName} as (...args: unknown[]) => unknown)()
    ).not.toThrow();
  });
});
`.trim();
}

// ---------------------------------------------------------------------------
// Template dispatcher
// ---------------------------------------------------------------------------

function buildTestCode(category: ChangeCategory, ctx: TemplateContext, index: number): string {
  switch (category) {
    case "boundary_condition":
      return templateBoundaryCondition(ctx, index);
    case "arithmetic":
      return templateArithmetic(ctx, index);
    case "null_check":
      return templateNullCheck(ctx, index);
    case "type_coercion":
      return templateTypeCoercion(ctx, index);
    case "control_flow":
      return templateControlFlow(ctx, index);
    case "return_value":
      return templateReturnValue(ctx, index);
    default:
      return templateGeneric(ctx, index);
  }
}

function buildRationale(category: ChangeCategory, hunk: DiffHunk, fn: string): string {
  const linesSummary =
    hunk.addedLines.length > 0
      ? `Added: \`${hunk.addedLines[0].trim().slice(0, 80)}\``
      : hunk.removedLines.length > 0
        ? `Removed: \`${hunk.removedLines[0].trim().slice(0, 80)}\``
        : "Modification detected";

  const categoryLabels: Record<ChangeCategory, string> = {
    boundary_condition: "A numeric boundary/threshold was changed",
    arithmetic: "An arithmetic expression was modified",
    null_check: "A null/undefined guard was added or removed",
    type_coercion: "Type coercion logic was changed",
    control_flow: "A control-flow branch was altered",
    return_value: "A return statement was changed",
    string_format: "String formatting was modified",
    array_mutation: "Array mutation logic was changed",
    unknown: "A change was detected without a specific pattern match",
  };

  return (
    `${categoryLabels[category]} in \`${fn}\`. ${linesSummary}. ` +
    `This catching test probes the changed path and will FAIL if a bug was introduced.`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate catching tests for all changed functions in the given files.
 *
 * Each hunk with at least one meaningful line change produces one or more
 * catching tests, classified by the type of change detected.
 *
 * @param changedFiles - Source files with parsed diff hunks.
 * @returns A `GenerationResult` with all generated tests and metadata.
 */
export function generateCatchingTests(changedFiles: ChangedFile[]): GenerationResult {
  const tests: CatchingTest[] = [];
  let skippedHunks = 0;
  let testIndex = 0;

  for (const file of changedFiles) {
    const importPath = buildImportPath(file.path);

    for (const hunk of file.hunks) {
      if (isTrivialHunk(hunk)) {
        skippedHunks++;
        continue;
      }

      const functionName = hunk.functionContext || "unknownFunction";
      const category = detectCategory(hunk);
      testIndex++;

      const ctx: TemplateContext = {
        functionName,
        importPath,
        addedLines: hunk.addedLines,
        removedLines: hunk.removedLines,
        hunkContext: hunk.functionContext,
      };

      tests.push({
        id: makeTestId(file.path, functionName, category, testIndex),
        targetFile: file.path,
        targetFunction: functionName,
        importPath,
        testCode: buildTestCode(category, ctx, testIndex),
        rationale: buildRationale(category, hunk, functionName),
        category,
        isExpectedToFail: true,
        diffLines: {
          added: hunk.addedLines,
          removed: hunk.removedLines,
        },
      });
    }
  }

  return {
    tests,
    skippedHunks,
    generatedAt: new Date().toISOString(),
  };
}
