// ============================================================================
// Delivery Intel — Scanning Sequence  (TUI spinner)
// ============================================================================
// Uses nanospinner to show a pulsing cyan animation while the analysis runs.
// ============================================================================

import { createSpinner } from "nanospinner";
import chalk from "chalk";

const cyan = chalk.hex("#00f2fe");
const green = chalk.hex("#39ff14");

/**
 * Animate a two-phase scanning sequence around a long-running promise.
 *
 * Phase 1 (0 → 1.5 s):  "📡 Synchronizing GitHub Heartbeat..."
 * Phase 2 (1.5 s → done):  "🔍 Running DORA Diagnostic..."
 *
 * Returns the resolved value of `task`.
 */
export async function withScanSequence<T>(task: Promise<T>): Promise<T> {
  const spinner = createSpinner(cyan.bold("📡 Synchronizing GitHub Heartbeat..."), {
    color: "cyan",
  });
  spinner.start();

  // Phase 2 swap
  const phaseTimer = setTimeout(() => {
    spinner.update({
      text: cyan.bold("🔍 Running DORA Diagnostic..."),
    });
  }, 1500);

  try {
    const result = await task;
    clearTimeout(phaseTimer);
    spinner.success({
      text: green.bold("✓ Diagnostic complete"),
    });
    return result;
  } catch (err) {
    clearTimeout(phaseTimer);
    spinner.error({
      text: chalk.hex("#ff073a").bold("✗ Diagnostic failed"),
    });
    throw err;
  }
}
