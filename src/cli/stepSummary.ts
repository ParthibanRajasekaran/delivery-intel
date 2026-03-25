// ============================================================================
// Delivery Intel — GitHub Step Summary  (CI Visualization)
// ============================================================================
// Generates rich Markdown + inline SVG for GITHUB_STEP_SUMMARY.
// Includes a color-coded SVG Progress Ring for the health score.
// ============================================================================

import * as fs from "node:fs";
import type { AnalysisResult, DORAMetrics, DependencyVulnerability } from "./analyzer.js";

// ---------------------------------------------------------------------------
// SVG Progress Ring
// ---------------------------------------------------------------------------

/**
 * Generate an inline SVG progress ring.
 *
 * - `stroke-dasharray` controls how much of the circle is filled.
 * - Color changes based on score: Red < 50, Yellow 50-80, Green > 80.
 */
export function svgProgressRing(score: number, size = 120): string {
  const radius = (size - 12) / 2; // leave room for stroke
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const cx = size / 2;
  const cy = size / 2;

  let ringColor: string;
  if (score >= 80) {
    ringColor = "#39ff14"; // Neon Green
  } else if (score >= 50) {
    ringColor = "#ffbe0b"; // Amber / Yellow
  } else {
    ringColor = "#ff073a"; // Electric Red
  }

  // The SVG must be on a single line (no newlines) for GitHub Markdown rendering.
  return [
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`,
    `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#1e293b" stroke-width="10"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${ringColor}" stroke-width="10"`,
    ` stroke-linecap="round" stroke-dasharray="${circumference.toFixed(2)}"`,
    ` stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`,
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"`,
    ` font-size="28" font-weight="bold" fill="${ringColor}">${score}</text>`,
    `</svg>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// Markdown sections
// ---------------------------------------------------------------------------

function scoreLabel(score: number): string {
  if (score >= 80) {
    return "🟢 Excellent";
  }
  if (score >= 50) {
    return "🟡 Moderate";
  }
  return "🔴 Critical";
}

function ratingEmoji(rating: string): string {
  switch (rating) {
    case "Elite":
      return "🏆";
    case "High":
      return "🔵";
    case "Medium":
      return "🟡";
    case "Low":
      return "🔴";
    default:
      return "⚪";
  }
}

function sparklineMarkdown(daily: number[]): string {
  const CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const max = Math.max(...daily, 1);
  return daily.map((v) => CHARS[Math.min(Math.round((v / max) * 7), 7)]).join("");
}

// DORA benchmark reference targets
const BENCHMARKS: Record<string, string> = {
  "Deploy Frequency": "Elite ≥ 7/wk",
  "Lead Time": "Elite < 24 h",
  "Change Failure Rate": "Elite ≤ 5%",
};

function doraTable(dora: DORAMetrics, daily: number[]): string {
  const lines: string[] = [];
  lines.push(
    "### 📊 DORA Metrics\n",
    "| Metric | Value | Rating | Benchmark |",
    "|--------|-------|--------|-----------|",
    `| Deploy Frequency | ${dora.deploymentFrequency.deploymentsPerWeek}/wk ${sparklineMarkdown(daily)} | ${ratingEmoji(dora.deploymentFrequency.rating)} ${dora.deploymentFrequency.rating} | ${BENCHMARKS["Deploy Frequency"]} |`,
    `| Lead Time | ${dora.leadTimeForChanges.medianHours}h median | ${ratingEmoji(dora.leadTimeForChanges.rating)} ${dora.leadTimeForChanges.rating} | ${BENCHMARKS["Lead Time"]} |`,
    `| Change Failure Rate | ${dora.changeFailureRate.percentage}% (${dora.changeFailureRate.failedRuns}/${dora.changeFailureRate.totalRuns}) | ${ratingEmoji(dora.changeFailureRate.rating)} ${dora.changeFailureRate.rating} | ${BENCHMARKS["Change Failure Rate"]} |`,
  );
  return lines.join("\n");
}

function vulnTable(vulns: DependencyVulnerability[]): string {
  if (vulns.length === 0) {
    return "### 🔒 Vulnerabilities\n\n✅ No known vulnerabilities found.\n";
  }
  const lines: string[] = [];
  lines.push(
    `### 🔒 Vulnerabilities (${vulns.length})\n`,
    "| Severity | Package | ID | Fix |",
    "|----------|---------|-----|-----|",
  );
  for (const v of vulns.slice(0, 15)) {
    const fixCell = v.fixedVersion ? `\`${v.fixedVersion}\`` : "—";
    lines.push(
      `| ${v.severity.toUpperCase()} | \`${v.packageName}@${v.currentVersion}\` | ${v.vulnId} | ${fixCell} |`,
    );
  }
  if (vulns.length > 15) {
    lines.push(`\n_…and ${vulns.length - 15} more_`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a full Markdown report with an inline SVG progress ring,
 * DORA table, and vulnerability table.
 */
export function generateStepSummaryMarkdown(result: AnalysisResult): string {
  const sections: string[] = [];

  // Header with inline SVG ring
  sections.push("## 📡 Delivery Intel — Cyber-Diagnostic Report\n");
  sections.push(`| Health Score | Details |`);
  sections.push(`|:-----------:|---------|`);
  sections.push(
    `| ${svgProgressRing(result.overallScore)} | **${result.overallScore}/100** — ${scoreLabel(result.overallScore)}<br>Repository: \`${result.repo.owner}/${result.repo.repo}\`<br>Scanned: ${result.fetchedAt} |`,
  );
  sections.push("");

  // DORA table
  sections.push(doraTable(result.doraMetrics, result.dailyDeployments));
  sections.push("");

  // Vulnerability table
  sections.push(vulnTable(result.vulnerabilities));
  sections.push("");

  // Suggestions
  if (result.suggestions.length > 0) {
    sections.push("### 💡 Suggestions\n");
    for (const s of result.suggestions) {
      const iconMap: Record<string, string> = { security: "🔒", reliability: "🛡️" };
      const icon = iconMap[s.category] ?? "⚡";
      sections.push(`- ${icon} **${s.title}** (${s.severity}) — ${s.description}`);
    }
    sections.push("");
  }

  // Footer
  sections.push(
    "---\n_Generated by [delivery-intel](https://github.com/ParthibanRajasekaran/delivery-intel)_\n",
  );

  return sections.join("\n");
}

/**
 * Write the Markdown report to `$GITHUB_STEP_SUMMARY` if running inside
 * GitHub Actions.  Returns `true` if the write succeeded.
 */
export function writeStepSummary(result: AnalysisResult): boolean {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return false;
  }
  try {
    const md = generateStepSummaryMarkdown(result);
    fs.appendFileSync(summaryPath, md + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}
