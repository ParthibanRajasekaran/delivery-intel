// ============================================================================
// Delivery Intel — Cyber-Diagnostic Renderer  (Liquid Glass™ 2026)
// ============================================================================
// High-fidelity terminal output with chalk, boxen, and Unicode box-drawing.
// Palette: Cyan #00f2fe · Deep Blue #4facfe · Neon Green #39ff14 · Red #ff073a
// ============================================================================

import chalk, { type ChalkInstance } from "chalk";
import boxen from "boxen";
import type {
  AnalysisResult,
  DORAMetrics,
  DependencyVulnerability,
  Suggestion,
} from "./analyzer.js";
import type { RiskBreakdown } from "./riskEngine.js";

// ---------------------------------------------------------------------------
// Palette  (Liquid Glass)
// ---------------------------------------------------------------------------

/** Primary Cyan  (#00f2fe) */
const cyan = chalk.hex("#00f2fe");
/** Secondary Deep Blue (#4facfe) */
const blue = chalk.hex("#4facfe");
/** Success Neon Green (#39ff14) */
const green = chalk.hex("#39ff14");
/** Error Electric Red (#ff073a) */
const red = chalk.hex("#ff073a");
/** Warm amber for warnings */
const amber = chalk.hex("#ffbe0b");
/** Muted label */
const dim = chalk.gray;
/** Bold white for data */
const bold = chalk.bold.white;

// ---------------------------------------------------------------------------
// Box-drawing helpers
// ---------------------------------------------------------------------------

/**
 * Wraps text in a Unicode single-line box with the given chalk color.
 * Falls back to boxen for the health-score hero card.
 */
const ALLOWED_BORDER_COLORS = ["cyan", "green", "red", "yellow"] as const;
type BorderColor = (typeof ALLOWED_BORDER_COLORS)[number];

function drawBox(
  content: string,
  opts: { borderColor?: string; title?: string; padding?: number } = {},
): string {
  const borderColor: BorderColor =
    opts.borderColor && ALLOWED_BORDER_COLORS.includes(opts.borderColor as BorderColor)
      ? (opts.borderColor as BorderColor)
      : "cyan";

  return boxen(content, {
    borderColor,
    borderStyle: "round" as const,
    padding: opts.padding ?? 1,
    title: opts.title,
    titleAlignment: "left",
  });
}

// ---------------------------------------------------------------------------
// Sparklines  (▁ ▂ ▃ ▄ ▅ ▆ ▇ █)
// ---------------------------------------------------------------------------

const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Render a 7-value sparkline using Unicode block elements.
 * Each bar is colored on a cyan→green gradient based on relative height.
 */
export function sparkline(values: number[]): string {
  const max = Math.max(...values, 1);
  return values
    .map((v) => {
      const idx = Math.min(Math.round((v / max) * 7), 7);
      const ch = SPARK_CHARS[idx];
      // color: low values → dim cyan, high values → neon green
      return idx <= 3 ? cyan(ch) : green(ch);
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Rating badge
// ---------------------------------------------------------------------------

function ratingBadge(rating: string): string {
  switch (rating) {
    case "Elite":
      return green.bold(` ★ ${rating}  `);
    case "High":
      return blue.bold(` ● ${rating}   `);
    case "Medium":
      return amber.bold(` ◆ ${rating} `);
    case "Low":
      return red.bold(` ▼ ${rating}    `);
    default:
      return dim(` ${rating} `);
  }
}

function severityTag(sev: string): string {
  const upper = sev.toUpperCase();
  switch (sev) {
    case "critical":
      return chalk.bgHex("#ff073a").white.bold(` ${upper} `);
    case "high":
      return red.bold(upper);
    case "medium":
      return amber(upper);
    case "low":
      return blue(upper);
    default:
      return dim(upper);
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function renderBanner(result: AnalysisResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(cyan.bold("  ┌─────────────────────────────────────────────────────────┐"));
  lines.push(
    cyan.bold("  │") +
      "  📡 " +
      bold("Delivery Intel") +
      "  " +
      dim("— Cyber-Diagnostic Report 2026") +
      "   " +
      cyan.bold("│"),
  );
  lines.push(cyan.bold("  └─────────────────────────────────────────────────────────┘"));
  lines.push("");
  lines.push("  " + dim("Repository  ") + bold(`${result.repo.owner}/${result.repo.repo}`));
  lines.push("  " + dim("Scanned     ") + dim(result.fetchedAt));
  lines.push("");
  return lines.join("\n");
}

function renderHealthScore(score: number): string {
  const width = 30;
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;

  let barColor: ChalkInstance;
  let label: string;
  if (score >= 80) {
    barColor = green;
    label = green.bold("EXCELLENT");
  } else if (score >= 50) {
    barColor = amber;
    label = amber.bold("MODERATE");
  } else {
    barColor = red;
    label = red.bold("CRITICAL");
  }

  const bar =
    barColor("█".repeat(filled)) +
    dim("░".repeat(empty)) +
    "  " +
    bold(`${score}`) +
    dim("/100") +
    "  " +
    label;

  const inner = cyan.bold("⬡  Overall Health Score") + "\n\n" + "  " + bar;

  return drawBox(inner, { borderColor: "cyan", padding: 1 });
}

function renderDORA(dora: DORAMetrics, daily: number[]): string {
  const lines: string[] = [];
  const sep = dim("─".repeat(56));

  lines.push("");
  lines.push("  " + cyan.bold("◈  DORA Metrics"));
  lines.push("  " + sep);
  lines.push("");

  // Deploy frequency + sparkline
  const df = dora.deploymentFrequency;
  lines.push("  " + bold("Deploy Frequency") + "    " + ratingBadge(df.rating));
  lines.push("  " + dim("How often code ships to production"));
  lines.push(
    "  " +
      bold(`${df.deploymentsPerWeek}`) +
      dim(" deployments/week") +
      "  " +
      dim("(") +
      dim(df.source === "merged_prs_fallback" ? "merged PRs" : "Deployments API") +
      dim(")"),
  );
  lines.push(
    "  " + dim("Last 7 days  ") + sparkline(daily) + "  " + dim(daily.map(String).join(" ")),
  );
  lines.push("");

  // Lead time
  const lt = dora.leadTimeForChanges;
  lines.push("  " + bold("Lead Time") + "             " + ratingBadge(lt.rating));
  lines.push("  " + dim("PR creation → merge (branch active duration)"));
  lines.push(
    "  " +
      bold(`${lt.medianHours}`) +
      dim(" hours median") +
      "  " +
      dim(`(${(lt.medianHours / 24).toFixed(1)} days)`),
  );
  lines.push("");

  // Change failure rate
  const cfr = dora.changeFailureRate;
  lines.push("  " + bold("Change Failure Rate") + "   " + ratingBadge(cfr.rating));
  lines.push("  " + dim("Percentage of deployment pipeline runs that failed"));
  lines.push(
    "  " +
      bold(`${cfr.percentage}%`) +
      "  " +
      dim(`(${cfr.failedRuns} failed / ${cfr.totalRuns} total runs)`),
  );
  lines.push("");

  return lines.join("\n");
}

function renderVulnerabilities(vulns: DependencyVulnerability[]): string {
  const lines: string[] = [];
  const sep = dim("─".repeat(56));

  lines.push("  " + cyan.bold("◈  Vulnerability Scan") + dim("  (OSV.dev)"));
  lines.push("  " + sep);
  lines.push("");

  if (vulns.length === 0) {
    lines.push("  " + green("✓ No known vulnerabilities found"));
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    "  " +
      red.bold(`${vulns.length}`) +
      red(` vulnerabilit${vulns.length === 1 ? "y" : "ies"} found`),
  );
  lines.push("");

  // Group & render by severity
  const grouped: Record<string, DependencyVulnerability[]> = {};
  for (const v of vulns) {
    if (!grouped[v.severity]) {
      grouped[v.severity] = [];
    }
    grouped[v.severity].push(v);
  }

  const order = ["critical", "high", "medium", "low", "unknown"];
  for (const sev of order) {
    const list = grouped[sev];
    if (!list) {
      continue;
    }
    lines.push("  " + severityTag(sev) + " " + dim(`(${list.length})`));
    for (const v of list.slice(0, 5)) {
      const fix = v.fixedVersion ? green(`→ ${v.fixedVersion}`) : dim("no fix");
      lines.push(
        "    " +
          dim("•") +
          " " +
          v.packageName +
          dim(`@${v.currentVersion}`) +
          "  " +
          dim(v.vulnId) +
          "  " +
          fix,
      );
    }
    if (list.length > 5) {
      lines.push("    " + dim(`  + ${list.length - 5} more`));
    }
  }
  lines.push("");

  return lines.join("\n");
}

function renderSuggestions(suggestions: Suggestion[]): string {
  const lines: string[] = [];
  const sep = dim("─".repeat(56));

  lines.push("  " + cyan.bold("◈  Suggestions"));
  lines.push("  " + sep);
  lines.push("");

  for (const s of suggestions) {
    const icon = s.category === "security" ? "🔒" : s.category === "reliability" ? "🛡️ " : "⚡";
    lines.push("  " + icon + " " + severityTag(s.severity) + " " + bold(s.title));
    lines.push("  " + dim(s.description));
    for (const action of s.actionItems) {
      lines.push("    " + cyan("→") + " " + action);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Risk Score section
// ---------------------------------------------------------------------------

function renderRiskScore(risk: RiskBreakdown): string {
  const lines: string[] = [];
  const sep = dim("─".repeat(56));

  lines.push("  " + cyan.bold("◈  Burnout Risk Score"));
  lines.push("  " + sep);
  lines.push("");

  // Risk gauge bar
  const width = 30;
  const filled = Math.round((risk.score / 100) * width);
  const empty = width - filled;

  let barColor: ChalkInstance;
  if (risk.level === "low") {
    barColor = green;
  } else if (risk.level === "moderate") {
    barColor = amber;
  } else if (risk.level === "high") {
    barColor = red;
  } else {
    barColor = chalk.bgHex("#ff073a").white;
  }

  const bar =
    barColor("█".repeat(filled)) +
    dim("░".repeat(empty)) +
    "  " +
    bold(`${risk.score}`) +
    dim("/100") +
    "  " +
    barColor.bold(risk.level.toUpperCase());

  lines.push("  " + bar);
  lines.push("");
  lines.push("  " + dim("Δ Cycle Time    ") + bold(`${(risk.cycleTimeDelta * 100).toFixed(1)}%`));
  lines.push("  " + dim("Δ Failure Rate  ") + bold(`${(risk.failureRateDelta * 100).toFixed(1)}%`));
  if (risk.sentimentMultiplier > 1.0) {
    lines.push(
      "  " + dim("Sentiment       ") + amber.bold(`×${risk.sentimentMultiplier.toFixed(2)}`),
    );
  }
  lines.push("");
  lines.push("  " + dim(risk.summary));
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Narrative section
// ---------------------------------------------------------------------------

function renderNarrative(narrative: string, model: string): string {
  const lines: string[] = [];
  const sep = dim("─".repeat(56));

  lines.push("  " + cyan.bold("◈  Executive Narrative") + "  " + dim(`(${model})`));
  lines.push("  " + sep);
  lines.push("");

  // Format narrative paragraphs, preserving existing line breaks
  for (const paragraph of narrative.split("\n\n")) {
    const trimmed = paragraph.trim();
    if (trimmed) {
      lines.push("  " + trimmed.replaceAll("\n", "\n  "));
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderFooter(): string {
  return (
    dim("  ─".repeat(19)) +
    "\n" +
    "  " +
    dim("Powered by") +
    " " +
    cyan.bold("delivery-intel") +
    " " +
    dim("· https://github.com/ParthibanRajasekaran/delivery-intel") +
    "\n"
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CyberReportOptions {
  risk?: RiskBreakdown;
  narrative?: string;
  narrativeModel?: string;
}

/**
 * Render a full Cyber-Diagnostic report to a styled string for the terminal.
 * This output is for human eyes only — JSON mode bypasses this entirely.
 */
export function renderCyberReport(
  result: AnalysisResult,
  options: CyberReportOptions = {},
): string {
  const parts: string[] = [];

  parts.push(renderBanner(result));
  parts.push(renderHealthScore(result.overallScore));
  parts.push(renderDORA(result.doraMetrics, result.dailyDeployments));
  if (options.risk) {
    parts.push(renderRiskScore(options.risk));
  }
  parts.push(renderVulnerabilities(result.vulnerabilities));
  parts.push(renderSuggestions(result.suggestions));
  if (options.narrative) {
    parts.push(renderNarrative(options.narrative, options.narrativeModel ?? "template"));
  }
  parts.push(renderFooter());

  return parts.join("\n");
}
