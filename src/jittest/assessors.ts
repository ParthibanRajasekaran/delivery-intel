// ============================================================================
// JITTest — Assessors
// ============================================================================
// Two-stage false-positive reduction system, directly modelling the approach
// from the Meta JITTest paper (arXiv:2601.22832):
//
//   Stage 1 — Rule-based assessors (fast, cheap, deterministic)
//     Applied first. Discard catching tests that clearly cannot surface a real
//     bug (e.g. no assertions, missing describe block, or trivial function
//     target).
//
//   Stage 2 — LLM-based assessor (pluggable interface)
//     Applied to the candidates that survive Stage 1. The stub here is
//     intentionally synchronous and deterministic so the pipeline works without
//     an LLM key; a real implementation can replace `llmAssessor` with a call
//     to any AI API (GPT-4, Claude, Gemini, etc.).
//
// The paper reports that combined assessors reduce human review load by 70%.
// ============================================================================

import type { CatchingTest } from "./catchingTestGenerator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Final verdict for a single catching test. */
export type AssessmentVerdict =
  | "candidate_catch" // Likely a true catching test — surface to engineers
  | "false_positive" // Almost certainly not catching a real bug — discard
  | "needs_review"; // Cannot determine automatically — human triage required

/** Result of assessing a single `CatchingTest`. */
export interface AssessmentResult {
  testId: string;
  verdict: AssessmentVerdict;
  /** Normalised confidence that this is NOT a false positive. Range [0, 1]. */
  confidence: number;
  /**
   * List of rule names / reasons that influenced the verdict.
   * Used for audit trails and debugging.
   */
  reasons: string[];
  /** Stage that produced this verdict (for tracing). */
  producedBy: "rule_based" | "llm_based" | "combined";
}

/** Assessed catching test — joins the test with its assessment. */
export interface AssessedCatchingTest {
  test: CatchingTest;
  assessment: AssessmentResult;
}

// ---------------------------------------------------------------------------
// Rule-based assessors (Stage 1)
// ---------------------------------------------------------------------------

/** Returns true when the test code contains at least one Vitest assertion. */
function ruleHasAssertions(testCode: string): { pass: boolean; reason: string } {
  const hasExpect = /\bexpect[ \t]*\(/.test(testCode);
  return {
    pass: hasExpect,
    reason: hasExpect
      ? "test contains expect() calls"
      : "FAIL: test has no expect() assertions — always a false positive",
  };
}

/** Returns true when the test has at least one describe() block. */
function ruleHasDescribeBlock(testCode: string): { pass: boolean; reason: string } {
  const hasDescribe = /\bdescribe[ \t]*\(/.test(testCode);
  return {
    pass: hasDescribe,
    reason: hasDescribe
      ? "test is structured in a describe() block"
      : "FAIL: no describe() block — likely a generation artefact",
  };
}

/** Returns true when the test has at least one it() or test() call. */
function ruleHasTestCase(testCode: string): { pass: boolean; reason: string } {
  const hasIt = /\b(?:it|test)[ \t]*\(/.test(testCode);
  return {
    pass: hasIt,
    reason: hasIt
      ? "test contains at least one it()/test() case"
      : "FAIL: no it()/test() blocks found",
  };
}

/** Returns true when the target function name is not a generic/placeholder. */
function ruleNonTrivialTarget(functionName: string): { pass: boolean; reason: string } {
  const trivialNames = new Set(["unknownFunction", "constructor", "render", "default", ""]);
  const isTrivial = trivialNames.has(functionName);
  return {
    pass: !isTrivial,
    reason: isTrivial
      ? `FAIL: target function "${functionName}" is a generic/placeholder name`
      : `target function "${functionName}" is a named, specific function`,
  };
}

/**
 * Returns true when the generated test does not import from a clearly wrong
 * path. Checks that the import path isn't the bare placeholder string.
 */
function ruleImportPathNotEmpty(importPath: string): { pass: boolean; reason: string } {
  const valid = importPath.length > 1 && importPath !== "@/";
  return {
    pass: valid,
    reason: valid
      ? `import path "${importPath}" is non-empty`
      : "FAIL: import path is empty or malformed",
  };
}

/**
 * Returns true when the test code does not call the function with zero real
 * arguments in ALL cases (a sign of a purely trivial covering test).
 * We check by counting invocations with actual content inside the parens.
 */
function ruleHasNonEmptyInvocation(testCode: string): { pass: boolean; reason: string } {
  // Strip vitest helpers (describe/it/expect/test) before checking for function
  // calls with arguments — otherwise describe("...") always satisfies the rule.
  const stripped = testCode.replaceAll(
    /\b(?:describe|it|test|expect|import|from|require)[ \t]*\(/g,
    "__VITEST__(",
  );
  const hasArgs = /\w+[ \t]*\([^)\n]{1,500}\)/.test(stripped);
  return {
    pass: hasArgs,
    reason: hasArgs
      ? "function invocations include arguments"
      : "WARN: all invocations appear to use empty argument lists",
  };
}

/**
 * Returns true when the diff that triggered this test had at least one
 * meaningful line change (not just whitespace).
 */
function ruleDiffHasMeaningfulChange(
  addedLines: string[],
  removedLines: string[],
): { pass: boolean; reason: string } {
  const meaningful = (l: string) => l.trim().length > 0;
  const hasMeaningful = addedLines.some(meaningful) || removedLines.some(meaningful);
  return {
    pass: hasMeaningful,
    reason: hasMeaningful
      ? "diff contains meaningful code changes"
      : "FAIL: diff is whitespace-only — catching test is unnecessary",
  };
}

// ---------------------------------------------------------------------------
// Stage 1: apply all rule-based assessors
// ---------------------------------------------------------------------------

/**
 * Apply all rule-based assessors to a single catching test.
 *
 * Returns `false_positive` if any hard-fail rule triggers, otherwise
 * `candidate_catch` with an aggregate confidence score, or `needs_review`
 * if only soft warnings accumulated.
 */
export function applyRuleBasedAssessors(test: CatchingTest): AssessmentResult {
  const reasons: string[] = [];
  let hardFailed = false;
  let warnings = 0;

  // Hard-fail rules (fail = definitely false positive)
  const hardRules: Array<{ pass: boolean; reason: string }> = [
    ruleHasAssertions(test.testCode),
    ruleHasDescribeBlock(test.testCode),
    ruleHasTestCase(test.testCode),
    ruleNonTrivialTarget(test.targetFunction),
    ruleImportPathNotEmpty(test.importPath),
    ruleDiffHasMeaningfulChange(test.diffLines.added, test.diffLines.removed),
  ];

  for (const rule of hardRules) {
    reasons.push(rule.reason);
    if (!rule.pass && rule.reason.startsWith("FAIL:")) {
      hardFailed = true;
    }
  }

  // Soft-warn rules (warn = reduce confidence but don't eliminate)
  const softRules: Array<{ pass: boolean; reason: string }> = [
    ruleHasNonEmptyInvocation(test.testCode),
  ];

  for (const rule of softRules) {
    reasons.push(rule.reason);
    if (!rule.pass && rule.reason.startsWith("WARN:")) {
      warnings++;
    }
  }

  if (hardFailed) {
    return {
      testId: test.id,
      verdict: "false_positive",
      confidence: 0.05,
      reasons,
      producedBy: "rule_based",
    };
  }

  // Confidence: start at 0.8, reduce by 0.1 per warning
  const confidence = Math.max(0.3, 0.8 - warnings * 0.1);

  // If only soft warnings lower confidence below 0.5, escalate to human review
  const verdict: AssessmentVerdict = confidence < 0.5 ? "needs_review" : "candidate_catch";

  return {
    testId: test.id,
    verdict,
    confidence,
    reasons,
    producedBy: "rule_based",
  };
}

// ---------------------------------------------------------------------------
// Stage 2: LLM-based assessor (pluggable stub)
// ---------------------------------------------------------------------------

/**
 * Interface for a custom LLM-based assessor. Swap this out in production with
 * a real call to any LLM API (OpenAI, Anthropic, etc.).
 */
export interface LLMAssessor {
  /**
   * Assess a catching test using an LLM.
   * @param test - The catching test to assess.
   * @param ruleResult - The rule-based result to use as context.
   * @returns Updated assessment. Implementations MUST populate `producedBy: "llm_based"`.
   */
  assess(test: CatchingTest, ruleResult: AssessmentResult): Promise<AssessmentResult>;
}

/**
 * Default no-op LLM assessor — passes the rule-based result through unchanged.
 * Replace by passing a real `LLMAssessor` to `assessCatchingTests`.
 */
export const noopLLMAssessor: LLMAssessor = {
  async assess(_test, ruleResult) {
    return { ...ruleResult, producedBy: "combined" };
  },
};

// ---------------------------------------------------------------------------
// Combined pipeline
// ---------------------------------------------------------------------------

/**
 * Run both assessment stages on a list of catching tests.
 *
 * Stage 1 (rule-based) runs synchronously on all tests.
 * Stage 2 (LLM) runs only on tests that survived Stage 1 as candidates or
 * needs_review — sparing LLM calls for obvious false positives.
 *
 * @param tests       - Tests to assess.
 * @param llmAssessor - Optional LLM assessor (defaults to no-op stub).
 * @returns Array of assessed catching tests with verdicts.
 */
export async function assessCatchingTests(
  tests: CatchingTest[],
  llmAssessor: LLMAssessor = noopLLMAssessor,
): Promise<AssessedCatchingTest[]> {
  const assessed: AssessedCatchingTest[] = [];

  for (const test of tests) {
    // Stage 1: rule-based
    const ruleResult = applyRuleBasedAssessors(test);

    if (ruleResult.verdict === "false_positive") {
      // Short-circuit: skip LLM for definite false positives
      assessed.push({ test, assessment: ruleResult });
      continue;
    }

    // Stage 2: LLM assessor
    const finalResult = await llmAssessor.assess(test, ruleResult);
    assessed.push({ test, assessment: finalResult });
  }

  return assessed;
}

// ---------------------------------------------------------------------------
// Aggregation utilities
// ---------------------------------------------------------------------------

/** Filter to only candidate catches (tests likely to catch a real bug). */
export function candidateCatches(assessed: AssessedCatchingTest[]): AssessedCatchingTest[] {
  return assessed.filter((a) => a.assessment.verdict === "candidate_catch");
}

/** Filter to tests that need human review. */
export function needsHumanReview(assessed: AssessedCatchingTest[]): AssessedCatchingTest[] {
  return assessed.filter((a) => a.assessment.verdict === "needs_review");
}

/** Filter to confirmed false positives. */
export function falsePositives(assessed: AssessedCatchingTest[]): AssessedCatchingTest[] {
  return assessed.filter((a) => a.assessment.verdict === "false_positive");
}

/** Compute the false-positive reduction rate (0-1). */
export function fpReductionRate(assessed: AssessedCatchingTest[]): number {
  if (assessed.length === 0) {
    return 0;
  }
  const fp = falsePositives(assessed).length;
  return fp / assessed.length;
}
