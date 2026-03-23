// ============================================================================
// JITTest — Assessors Tests
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  applyRuleBasedAssessors,
  assessCatchingTests,
  candidateCatches,
  falsePositives,
  needsHumanReview,
  fpReductionRate,
  noopLLMAssessor,
  type AssessedCatchingTest,
  type LLMAssessor,
} from "../../jittest/assessors";
import type { CatchingTest } from "../../jittest/catchingTestGenerator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCatchingTest(overrides: Partial<CatchingTest> = {}): CatchingTest {
  return {
    id: "jit_normalizeDelta_boundary_1",
    targetFile: "src/cli/riskEngine.ts",
    targetFunction: "normalizeDelta",
    importPath: "@/cli/riskEngine",
    testCode: `
import { describe, it, expect } from "vitest";
import { normalizeDelta } from "@/cli/riskEngine";

describe("[JITTest] normalizeDelta — boundary_condition catch", () => {
  it("should handle the exact boundary value", () => {
    const result = normalizeDelta(25, 24, 720);
    expect(result).toBeGreaterThan(0);
  });

  it("should not return 0 for values above the boundary", () => {
    const result = normalizeDelta(25, 24, 720);
    expect(result).not.toBe(0);
  });
});
    `.trim(),
    rationale:
      "A boundary condition was changed in `normalizeDelta`. This catching test probes the changed path.",
    category: "boundary_condition",
    isExpectedToFail: true,
    diffLines: {
      added: ["  const delta = (actual - eliteBenchmark) / (maxCap - eliteBenchmark + 1);"],
      removed: ["  const delta = (actual - eliteBenchmark) / (maxCap - eliteBenchmark);"],
    },
    ...overrides,
  };
}

/** Returns a test with NO assertions (definite false positive). */
const noAssertionsTest = makeCatchingTest({
  id: "jit_noAssertions_1",
  testCode: `
describe("[JITTest] foo", () => {
  it("does something", () => {
    // no expect calls here
    foo();
  });
});
  `.trim(),
});

/** Returns a test with no describe block. */
const noDescribeTest = makeCatchingTest({
  id: "jit_noDescribe_1",
  testCode: `
it("should work", () => {
  expect(normalizeDelta(25, 24, 720)).toBeGreaterThan(0);
});
  `.trim(),
});

/** Returns a test with no it() block. */
const noItTest = makeCatchingTest({
  id: "jit_noIt_1",
  testCode: `
describe("[JITTest] foo", () => {
  expect(1).toBe(1);
});
  `.trim(),
});

/** Returns a test targeting "unknownFunction" (trivial target). */
const trivialTargetTest = makeCatchingTest({
  id: "jit_trivial_1",
  targetFunction: "unknownFunction",
  testCode: `
describe("[JITTest] unknownFunction", () => {
  it("test", () => {
    expect(unknownFunction()).toBeDefined();
  });
});
  `.trim(),
});

/** Returns a test with an empty import path. */
const badImportTest = makeCatchingTest({
  id: "jit_badImport_1",
  importPath: "@/",
});

/** Returns a test with only whitespace in diffLines. */
const whitespaceOnlyDiffTest = makeCatchingTest({
  id: "jit_whitespace_1",
  diffLines: { added: ["   ", ""], removed: ["  "] },
});

// ---------------------------------------------------------------------------
// applyRuleBasedAssessors
// ---------------------------------------------------------------------------

describe("applyRuleBasedAssessors", () => {
  it("returns candidate_catch for a well-formed test", () => {
    const result = applyRuleBasedAssessors(makeCatchingTest());
    expect(result.verdict).toBe("candidate_catch");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("returns false_positive for a test with no assertions", () => {
    const result = applyRuleBasedAssessors(noAssertionsTest);
    expect(result.verdict).toBe("false_positive");
    expect(result.confidence).toBeLessThan(0.2);
  });

  it("returns false_positive for a test with no describe block", () => {
    const result = applyRuleBasedAssessors(noDescribeTest);
    expect(result.verdict).toBe("false_positive");
  });

  it("returns false_positive for a test with no it() block", () => {
    const result = applyRuleBasedAssessors(noItTest);
    expect(result.verdict).toBe("false_positive");
  });

  it("returns false_positive when targetFunction is unknownFunction", () => {
    const result = applyRuleBasedAssessors(trivialTargetTest);
    expect(result.verdict).toBe("false_positive");
  });

  it("returns false_positive for empty import path", () => {
    const result = applyRuleBasedAssessors(badImportTest);
    expect(result.verdict).toBe("false_positive");
  });

  it("returns false_positive for whitespace-only diff changes", () => {
    const result = applyRuleBasedAssessors(whitespaceOnlyDiffTest);
    expect(result.verdict).toBe("false_positive");
  });

  it("always includes reasons array", () => {
    const result = applyRuleBasedAssessors(makeCatchingTest());
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("marks producedBy as rule_based", () => {
    const result = applyRuleBasedAssessors(makeCatchingTest());
    expect(result.producedBy).toBe("rule_based");
  });

  it("testId matches the input test id", () => {
    const test = makeCatchingTest({ id: "custom_id_42" });
    const result = applyRuleBasedAssessors(test);
    expect(result.testId).toBe("custom_id_42");
  });

  it("confidence is between 0 and 1 inclusive", () => {
    const result = applyRuleBasedAssessors(makeCatchingTest());
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// assessCatchingTests (combined pipeline)
// ---------------------------------------------------------------------------

describe("assessCatchingTests", () => {
  it("returns an AssessedCatchingTest for each input test", async () => {
    const tests = [makeCatchingTest(), noAssertionsTest];
    const results = await assessCatchingTests(tests, noopLLMAssessor);
    expect(results).toHaveLength(2);
  });

  it("candidate tests pass through LLM assessor", async () => {
    let llmCalled = false;
    const customLLM: LLMAssessor = {
      async assess(_test, ruleResult) {
        llmCalled = true;
        return { ...ruleResult, producedBy: "llm_based" };
      },
    };
    await assessCatchingTests([makeCatchingTest()], customLLM);
    expect(llmCalled).toBe(true);
  });

  it("false positives are short-circuited (no LLM call for FPs)", async () => {
    let llmCalled = false;
    const customLLM: LLMAssessor = {
      async assess(_test, ruleResult) {
        llmCalled = true;
        return { ...ruleResult, producedBy: "llm_based" };
      },
    };
    await assessCatchingTests([noAssertionsTest], customLLM);
    expect(llmCalled).toBe(false);
  });

  it("handles an empty input array", async () => {
    const results = await assessCatchingTests([], noopLLMAssessor);
    expect(results).toHaveLength(0);
  });

  it("each result has test and assessment fields", async () => {
    const results = await assessCatchingTests([makeCatchingTest()], noopLLMAssessor);
    expect(results[0]).toHaveProperty("test");
    expect(results[0]).toHaveProperty("assessment");
  });
});

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

describe("aggregation utilities", () => {
  function makeAssessed(
    verdict: "candidate_catch" | "false_positive" | "needs_review",
  ): AssessedCatchingTest {
    return {
      test: makeCatchingTest({ id: `id_${verdict}` }),
      assessment: {
        testId: `id_${verdict}`,
        verdict,
        confidence:
          verdict === "candidate_catch" ? 0.9 : verdict === "false_positive" ? 0.05 : 0.45,
        reasons: ["test reason"],
        producedBy: "rule_based",
      },
    };
  }

  const mixed: AssessedCatchingTest[] = [
    makeAssessed("candidate_catch"),
    makeAssessed("candidate_catch"),
    makeAssessed("false_positive"),
    makeAssessed("needs_review"),
  ];

  it("candidateCatches filters to candidate_catch only", () => {
    const candidates = candidateCatches(mixed);
    expect(candidates).toHaveLength(2);
    candidates.forEach((a) => expect(a.assessment.verdict).toBe("candidate_catch"));
  });

  it("falsePositives filters to false_positive only", () => {
    const fps = falsePositives(mixed);
    expect(fps).toHaveLength(1);
    expect(fps[0].assessment.verdict).toBe("false_positive");
  });

  it("needsHumanReview filters to needs_review only", () => {
    const review = needsHumanReview(mixed);
    expect(review).toHaveLength(1);
    expect(review[0].assessment.verdict).toBe("needs_review");
  });

  it("fpReductionRate returns correct fraction", () => {
    const rate = fpReductionRate(mixed);
    expect(rate).toBeCloseTo(0.25, 2); // 1 FP out of 4 total
  });

  it("fpReductionRate returns 0 for empty array", () => {
    expect(fpReductionRate([])).toBe(0);
  });

  it("fpReductionRate returns 1 when all are FPs", () => {
    const allFPs = [makeAssessed("false_positive"), makeAssessed("false_positive")];
    expect(fpReductionRate(allFPs)).toBe(1);
  });

  it("fpReductionRate returns 0 when no FPs", () => {
    const nofps = [makeAssessed("candidate_catch"), makeAssessed("needs_review")];
    expect(fpReductionRate(nofps)).toBe(0);
  });
});
