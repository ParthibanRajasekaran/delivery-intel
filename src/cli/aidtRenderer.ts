// ============================================================================
// AIDT Renderer — Terminal output for Canary Trust Scoring
// ============================================================================

import chalk from "chalk";
import type { AidtResult } from "../aidt/types.js";

const cyan = chalk.hex("#00f2fe");
const green = chalk.hex("#39ff14");
const yellow = chalk.hex("#ffbe0b");
const red = chalk.hex("#ff073a");
const dim = chalk.gray;
const bold = chalk.bold;

const W = 55;
const INNER = W - 2; // usable width between the border pipes

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replaceAll(/\x1b\[[0-9;]*m/g, "");
}

function pad(line: string): string {
  const visible = stripAnsi(line);
  const spaces = Math.max(0, INNER - visible.length - 1);
  return `│ ${line}${" ".repeat(spaces)} │`;
}

/** Wrap a plain-text string into lines no longer than maxLen. */
function wrapText(text: string, maxLen: number): string[] {
  const words = text.split(" ");
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxLen) {
      current += " " + word;
    } else {
      result.push(current);
      current = word;
    }
  }
  if (current.length > 0) {
    result.push(current);
  }
  return result;
}

function tierColor(tier: "low" | "medium" | "high"): typeof chalk {
  if (tier === "high") {
    return red;
  }
  if (tier === "medium") {
    return yellow;
  }
  return green;
}

function tierLabel(tier: "low" | "medium" | "high"): string {
  const tc = tierColor(tier);
  const dots = tier === "high" ? "●●● HIGH" : tier === "medium" ? "●● MEDIUM" : "● LOW";
  return tc(dots);
}

export function renderAidtResult(result: AidtResult): string {
  const tc = tierColor(result.risk_tier);

  const authorshipLabel =
    result.ai_authorship_pct > 0.7
      ? red("(high)")
      : result.ai_authorship_pct > 0.4
        ? yellow("(moderate)")
        : green("(low)");

  const reviewVsBaseline =
    result.review_time_per_loc >= result.baseline_density
      ? green("(at or above baseline)")
      : yellow("(below baseline)");

  const top = `┌${"─".repeat(W)}┐`;
  const sep = `├${"─".repeat(W)}┤`;
  const bot = `└${"─".repeat(W)}┘`;

  // Wrap recommendation text to fit the box
  const recPrefix = "Recommendation: ";
  const recMaxLen = INNER - recPrefix.length - 1;
  const recLines = wrapText(result.recommendation, recMaxLen);

  const signalLine =
    `${bold("Signals:")} description=${result.authorship_signals.description_match ? red("match") : green("none")}` +
    `  entropy=${dim(result.authorship_signals.diff_entropy_score.toFixed(3))}` +
    (result.authorship_signals.copilot_acceptance_rate !== null
      ? `  copilot=${dim(result.authorship_signals.copilot_acceptance_rate.toFixed(2))}`
      : "");

  const lines = [
    top,
    pad(`${bold.white("AIDT Canary Trust Score")}  ·  ${cyan(`PR #${result.pr_number}`)}`),
    sep,
    pad(
      `${bold("AI authorship")}    ${tc(result.ai_authorship_pct.toFixed(3))}   ${authorshipLabel}`,
    ),
    pad(
      `${bold("Review density")}   ${yellow(`${result.review_time_per_loc.toFixed(1)}s/loc`)}  ${reviewVsBaseline}`,
    ),
    pad(
      `${bold("Baseline density")} ${dim(`${result.baseline_density.toFixed(1)}s/loc`)}  ${dim(`(${result.baseline_source})`)}`,
    ),
    pad(`${bold("Risk weight")}      ${tc(result.risk_weight.toFixed(3))}`),
    pad(
      `${bold("Canary duration")}  ${tc(`${result.canary_duration_minutes} min`)}  ${tierLabel(result.risk_tier)}`,
    ),
    sep,
    pad(signalLine),
    sep,
    pad(`${bold(recPrefix)}${cyan(recLines[0] ?? "")}`),
    ...recLines.slice(1).map((l) => pad(`  ${" ".repeat(recPrefix.length - 2)}${cyan(l)}`)),
    bot,
  ];

  return "\n" + lines.join("\n") + "\n";
}
