#!/usr/bin/env node
// ============================================================================
// JITTest CLI — Just-in-Time Catching Test Pipeline
// ============================================================================
// Usage:
//   npm run jittest                   # diff against HEAD (local)
//   npm run jittest -- --base-ref abc123  # diff against a specific commit
//   npm run jittest -- --output report.json  # write JSON report to file
//   npm run jittest -- --verbose      # verbose logging
//
// Exit codes:
//   0 — pipeline completed (even if candidate catches were found)
//   1 — pipeline error
// ============================================================================

import { writeFileSync } from "node:fs";
import { runJITTestPipeline } from "../jittest/runner.js";

// ---------------------------------------------------------------------------
// Argument parsing (no external deps)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args: { baseRef?: string; output?: string; verbose: boolean } = { verbose: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base-ref" && argv[i + 1]) {
      args.baseRef = argv[++i];
    } else if (arg === "--output" && argv[i + 1]) {
      args.output = argv[++i];
    } else if (arg === "--verbose" || arg === "-v") {
      args.verbose = true;
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  process.stderr.write("[jittest] Starting JITTest catching-test pipeline…\n");

  const report = await runJITTestPipeline({
    baseRef: args.baseRef,
    verbose: args.verbose,
  });

  // Always print the Markdown summary to stdout (for CI logs)
  process.stdout.write(report.markdownSummary + "\n");

  // Optionally write JSON report to file
  if (args.output) {
    writeFileSync(args.output, JSON.stringify(report, null, 2), "utf8");
    process.stderr.write(`[jittest] JSON report written to ${args.output}\n`);
  }

  // Summary line
  process.stderr.write(
    `[jittest] Done — ${report.candidateCatches.length} candidate catch(es), ` +
      `${report.falsePositives.length} FP(s) filtered ` +
      `(${(report.fpReductionRate * 100).toFixed(1)}% reduction rate)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[jittest] Fatal error: ${(err as Error).message}\n`);
  process.exit(1);
});
