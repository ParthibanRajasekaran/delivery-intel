// ============================================================================
// JITTest — Pipeline Runner
// ============================================================================
// Orchestrates the full JITTest catching-test pipeline:
//
//   git diff → DiffAnalysis → CatchingTests → Assessments → JITTestReport
//
// Invocation modes:
//   1. Programmatic (import and call `runJITTestPipeline`)
//   2. CLI (see bin/jittest entry point or `npm run jittest`)
//
// Reference: Meta JITTest (arXiv:2601.22832)
// ============================================================================

import { execFileSync } from "node:child_process";
import { parseDiff, filterSourceFiles } from "./diffAnalyzer.js";
import { generateCatchingTests } from "./catchingTestGenerator.js";
import {
  assessCatchingTests,
  candidateCatches,
  falsePositives,
  needsHumanReview,
  fpReductionRate,
  noopLLMAssessor,
  type LLMAssessor,
  type AssessedCatchingTest,
} from "./assessors.js";
import type { DiffAnalysis } from "./diffAnalyzer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JITTestOptions {
  /**
   * Raw unified diff string. If omitted, the runner executes
   * `git diff HEAD` (or `git diff <baseRef>`) in `cwd` to obtain one.
   */
  rawDiff?: string;
  /**
   * Git ref to diff against when `rawDiff` is not provided.
   * Defaults to "HEAD" (staged + unstaged changes).
   */
  baseRef?: string;
  /**
   * Working directory for the git command. Defaults to process.cwd().
   */
  cwd?: string;
  /**
   * Custom LLM assessor for Stage 2 FP reduction.
   * Defaults to the no-op stub (pass-through).
   */
  llmAssessor?: LLMAssessor;
  /**
   * If true, log progress to stderr (useful for CLI usage).
   */
  verbose?: boolean;
}

export interface JITTestReport {
  /** ISO timestamp when the report was generated. */
  timestamp: string;
  /** Summary stats from the parsed diff. */
  diffStats: DiffAnalysis["stats"];
  /** Total catching tests generated before assessment. */
  totalGenerated: number;
  /** Number of trivial hunks skipped during generation. */
  trivialHunksSkipped: number;
  /** Catching tests identified as candidate catches (likely real bugs). */
  candidateCatches: AssessedCatchingTest[];
  /** Tests needing manual human review (ambiguous verdict). */
  needsHumanReview: AssessedCatchingTest[];
  /** Tests discarded as false positives. */
  falsePositives: AssessedCatchingTest[];
  /** FP reduction rate: fraction of total tests identified as FPs. */
  fpReductionRate: number;
  /** Human-readable Markdown summary for PR comments / CI reports. */
  markdownSummary: string;
}

// ---------------------------------------------------------------------------
// Diff acquisition
// ---------------------------------------------------------------------------

/**
 * Obtain a unified diff string from the local git repository.
 * Uses `git diff <baseRef>..HEAD` when `baseRef` is provided, otherwise
 * `git diff HEAD` (includes both staged and unstaged changes).
 */
export function getDiffFromGit(baseRef?: string, cwd: string = process.cwd()): string {
  // Validate baseRef to prevent shell injection — only allow safe git ref characters
  if (baseRef && !/^[a-zA-Z0-9_.\-/~^]+$/.test(baseRef)) {
    throw new Error(
      `Invalid git ref: "${baseRef}". Only alphanumeric, dots, dashes, slashes, tildes, and carets are allowed.`,
    );
  }
  const args = baseRef
    ? ["diff", `${baseRef}..HEAD`, "--unified=5"]
    : ["diff", "HEAD", "--unified=5"];
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
  } catch (err) {
    throw new Error(
      `Failed to obtain git diff (command: "git ${args.join(" ")}"): ${(err as Error).message}`,
      {
        cause: err,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Markdown report builder
// ---------------------------------------------------------------------------

function verdictEmoji(count: number, label: string): string {
  if (label === "candidate_catches") {
    return count > 0 ? "🚨" : "✅";
  }
  if (label === "needs_review") {
    return count > 0 ? "⚠️" : "✅";
  }
  return "🗑️";
}

function buildMarkdownSummary(report: Omit<JITTestReport, "markdownSummary">): string {
  const {
    diffStats,
    totalGenerated,
    candidateCatches: cc,
    needsHumanReview: nr,
    falsePositives: fp,
  } = report;
  const fpPct = (report.fpReductionRate * 100).toFixed(1);

  const lines: string[] = [
    "## 🧪 JITTest — Just-in-Time Catching Test Report",
    "",
    `> Generated at ${report.timestamp}`,
    "",
    "### Diff Stats",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Files changed | ${diffStats.filesChanged} |`,
    `| Lines added | ${diffStats.totalAdditions} |`,
    `| Lines removed | ${diffStats.totalDeletions} |`,
    "",
    "### Assessment Summary",
    `| Category | Count |`,
    `|----------|-------|`,
    `| Total catching tests generated | ${totalGenerated} |`,
    `| ${verdictEmoji(cc.length, "candidate_catches")} Candidate catches (likely bugs) | **${cc.length}** |`,
    `| ${verdictEmoji(nr.length, "needs_review")} Needs human review | ${nr.length} |`,
    `| ${verdictEmoji(fp.length, "false_positives")} False positives filtered | ${fp.length} (${fpPct}%) |`,
    "",
  ];

  if (cc.length > 0) {
    lines.push(
      "### 🚨 Candidate Catches",
      "",
      "These tests are designed to FAIL if the code change introduces a bug.",
      "Investigate each before merging.",
      "",
    );
    for (const { test, assessment } of cc) {
      lines.push(
        `#### \`${test.targetFunction}\` in \`${test.targetFile}\``,
        `- **Category**: ${test.category}`,
        `- **Confidence**: ${(assessment.confidence * 100).toFixed(0)}%`,
        `- **Rationale**: ${test.rationale}`,
        `- **Test ID**: \`${test.id}\``,
        "",
      );
    }
  }

  if (nr.length > 0) {
    lines.push("### ⚠️ Needs Human Review", "");
    for (const { test } of nr) {
      lines.push(
        `- \`${test.id}\` — \`${test.targetFunction}\` in \`${test.targetFile}\` (${test.category})`,
      );
    }
    lines.push("");
  }

  lines.push(
    "---",
    `*JITTest pipeline based on [arXiv:2601.22832](https://arxiv.org/abs/2601.22832) — ` +
      `Just-in-Time Catching Test Generation at Meta*`,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public pipeline API
// ---------------------------------------------------------------------------

/**
 * Run the full JITTest pipeline end-to-end.
 *
 * Steps:
 *  1. Acquire diff (from `options.rawDiff` or git)
 *  2. Parse diff → `DiffAnalysis`
 *  3. Filter to source-only files
 *  4. Generate catching tests per changed hunk
 *  5. Apply rule-based + optional LLM assessors
 *  6. Build and return `JITTestReport`
 *
 * @param options - Pipeline configuration.
 */
export async function runJITTestPipeline(options: JITTestOptions = {}): Promise<JITTestReport> {
  const { rawDiff, baseRef, cwd, llmAssessor = noopLLMAssessor, verbose = false } = options;

  const log = (msg: string) => {
    if (verbose) {
      process.stderr.write(`[jittest] ${msg}\n`);
    }
  };

  // Step 1: Acquire diff
  log("Acquiring diff…");
  const diff = rawDiff ?? getDiffFromGit(baseRef, cwd);

  if (diff.trim().length === 0) {
    log("No diff found — nothing to test.");
    const empty: JITTestReport = {
      timestamp: new Date().toISOString(),
      diffStats: { filesChanged: 0, totalAdditions: 0, totalDeletions: 0 },
      totalGenerated: 0,
      trivialHunksSkipped: 0,
      candidateCatches: [],
      needsHumanReview: [],
      falsePositives: [],
      fpReductionRate: 0,
      markdownSummary: "## 🧪 JITTest\n\nNo diff detected — nothing to analyse.",
    };
    return empty;
  }

  // Step 2: Parse diff
  log("Parsing diff…");
  const analysis = parseDiff(diff);
  log(
    `Diff analysis: ${analysis.stats.filesChanged} file(s), ` +
      `+${analysis.stats.totalAdditions}/-${analysis.stats.totalDeletions} lines`,
  );

  // Step 3: Filter to source files only
  const sourceFiles = filterSourceFiles(analysis);
  log(`Source files with changes: ${sourceFiles.length}`);

  // Step 4: Generate catching tests
  log("Generating catching tests…");
  const genResult = generateCatchingTests(sourceFiles);
  log(
    `Generated ${genResult.tests.length} catching test(s) ` +
      `(${genResult.skippedHunks} trivial hunk(s) skipped)`,
  );

  // Step 5: Assess tests
  log("Assessing catching tests (rule-based + LLM)…");
  const assessed = await assessCatchingTests(genResult.tests, llmAssessor);

  const catches = candidateCatches(assessed);
  const review = needsHumanReview(assessed);
  const fps = falsePositives(assessed);
  const fpRate = fpReductionRate(assessed);

  log(`Assessment complete: ${catches.length} candidate catch(es), ${fps.length} FP(s) filtered`);

  // Step 6: Build report
  const reportData = {
    timestamp: new Date().toISOString(),
    diffStats: analysis.stats,
    totalGenerated: genResult.tests.length,
    trivialHunksSkipped: genResult.skippedHunks,
    candidateCatches: catches,
    needsHumanReview: review,
    falsePositives: fps,
    fpReductionRate: fpRate,
  };

  return {
    ...reportData,
    markdownSummary: buildMarkdownSummary(reportData),
  };
}
