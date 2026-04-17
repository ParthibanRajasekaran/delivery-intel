// ============================================================================
// Verdict Renderer
// ============================================================================
// Replaces the "metrics wall" with a diagnostic verdict:
//   - Overall grade + confidence + trend
//   - Biggest strengths (what's going well)
//   - Biggest risks (what needs attention)
//   - Fix First (top 3 prioritised actions with expected impact)
//   - Evidence chain for each metric
// ============================================================================

import chalk, { type ChalkInstance } from "chalk";
import type { AnalysisResultV2 } from "./analyzerV2.js";
import type { PolicyResult } from "../domain/policy.js";
import { toLetterGrade } from "../domain/policy.js";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const cyan = chalk.hex("#00f2fe");
const green = chalk.hex("#39ff14");
const yellow = chalk.hex("#ffbe0b");
const red = chalk.hex("#ff073a");
const dim = chalk.gray;
const bold = chalk.bold;
const white = chalk.bold.white;

function gradeChalk(score: number): ChalkInstance {
  if (score >= 80) {
    return chalk.bold.hex("#39ff14");
  }
  if (score >= 60) {
    return chalk.bold.hex("#ffbe0b");
  }
  return chalk.bold.hex("#ff073a");
}

function confidenceChalk(conf: string): ChalkInstance {
  if (conf === "high") {
    return green;
  }
  if (conf === "medium") {
    return yellow;
  }
  return red;
}

function trendArrow(delta: number | undefined): string {
  if (delta === undefined) {
    return "";
  }
  if (delta > 0) {
    return green(`↑ +${delta} pts`);
  }
  if (delta < 0) {
    return red(`↓ ${delta} pts`);
  }
  return dim("→ stable");
}

// ---------------------------------------------------------------------------
// Box drawing helpers
// ---------------------------------------------------------------------------

const W = 62;

function box(lines: string[]): string {
  const top = `┌${"─".repeat(W)}┐`;
  const bot = `└${"─".repeat(W)}┘`;
  const mid = lines.map((l) => {
    // Strip ANSI codes to measure visible length
    // eslint-disable-next-line no-control-regex
    const visible = l.replace(/\x1b\[[0-9;]*m/g, "");
    const pad = Math.max(0, W - visible.length - 2);
    return `│ ${l}${" ".repeat(pad)} │`;
  });
  return [top, ...mid, bot].join("\n");
}

function section(title: string): string {
  return `\n${bold.white(title)}\n${"─".repeat(W)}`;
}

function bullet(icon: string, text: string): string {
  return `  ${icon} ${text}`;
}

// ---------------------------------------------------------------------------
// Metric row for the evidence table
// ---------------------------------------------------------------------------

interface MetricRow {
  name: string;
  value: string;
  tier: string;
  confidence: string;
  source: string;
  caveats: string[];
}

function tierIcon(tier: string): string {
  if (tier === "Elite") {
    return green("◆");
  }
  if (tier === "High") {
    return green("●");
  }
  if (tier === "Medium") {
    return yellow("●");
  }
  if (tier === "Low") {
    return red("●");
  }
  return dim("○");
}

function confidenceBadge(conf: string): string {
  if (conf === "high") {
    return green("[high]");
  }
  if (conf === "medium") {
    return yellow("[med] ");
  }
  if (conf === "low") {
    return red("[low] ");
  }
  return dim("[?]   ");
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export function renderVerdict(
  result: AnalysisResultV2,
  policy: PolicyResult,
  scoreDelta?: number,
): string {
  const { scores, metrics, repoProfile, recommendations, scannedManifests, vulnerabilities } =
    result;
  const grade = toLetterGrade(scores.delivery.score);
  const gradeStr = gradeChalk(scores.delivery.score)(grade);
  const scoreStr = gradeChalk(scores.delivery.score)(`${scores.delivery.score}/100`);
  const confStr = confidenceChalk(scores.delivery.confidence)(scores.delivery.confidence);

  const lines: string[] = [];

  // ── Header box ────────────────────────────────────────────────────────────
  const repoLine = `  ${cyan(result.repo.owner)}${dim("/")}${cyan(result.repo.repo)}`;
  const gradeLine = `  Grade ${gradeStr}   Score ${scoreStr}   Confidence ${confStr}`;
  const trendLine = scoreDelta !== undefined ? `  Trend  ${trendArrow(scoreDelta)}` : "";
  const headerLines = [repoLine, gradeLine, ...(trendLine ? [trendLine] : [])];
  lines.push(box(headerLines));

  // ── Policy violations ─────────────────────────────────────────────────────
  if (policy.violations.length > 0) {
    const blocking = policy.violations.filter((v) => v.severity === "blocking");
    const warnings = policy.violations.filter((v) => v.severity === "warning");
    const infos = policy.violations.filter((v) => v.severity === "info");

    if (blocking.length > 0) {
      lines.push(section(`🚫  BLOCKING VIOLATIONS (${blocking.length})`));
      for (const v of blocking) {
        lines.push(bullet(red("✖"), white(v.ruleName)));
        lines.push(bullet("  ", dim(v.message)));
        lines.push(bullet("  ", dim(`Evidence: ${v.evidence}`)));
        lines.push(bullet("  ", cyan(`Fix: ${v.fix}`)));
      }
    }

    if (warnings.length > 0) {
      lines.push(section(`⚠   WARNINGS (${warnings.length})`));
      for (const v of warnings) {
        lines.push(bullet(yellow("▲"), white(v.ruleName)));
        lines.push(bullet("  ", dim(v.message)));
        lines.push(bullet("  ", dim(`Evidence: ${v.evidence}`)));
        lines.push(bullet("  ", cyan(`Fix: ${v.fix}`)));
      }
    }

    if (infos.length > 0) {
      lines.push(section(`ℹ   NOTES (${infos.length})`));
      for (const v of infos) {
        lines.push(bullet(dim("·"), dim(v.message)));
      }
    }
  } else {
    lines.push(section("✓   NO POLICY VIOLATIONS"));
    lines.push(bullet(green("✓"), "All delivery health policies are passing."));
  }

  // ── Metric evidence table ─────────────────────────────────────────────────
  lines.push(section("METRICS  (source · sample · confidence)"));

  const rows: MetricRow[] = [
    {
      name: "Deploy Frequency",
      value: metrics.deploymentFrequency.value
        ? `${metrics.deploymentFrequency.value.deploymentsPerWeek.toFixed(1)}/wk`
        : "—",
      tier: metrics.deploymentFrequency.tier,
      confidence: metrics.deploymentFrequency.confidence,
      source: metrics.deploymentFrequency.evidenceSources.join(", "),
      caveats: metrics.deploymentFrequency.caveats,
    },
    {
      name: "Change Lead Time",
      value: (() => {
        const v = metrics.changeLeadTime.value;
        if (!v) {
          return "—";
        }
        const h =
          v.primarySignal === "commit_to_deploy"
            ? v.commitToDeployMedianHours
            : v.prFlowMedianHours;
        return h !== null ? `${h}h` : "—";
      })(),
      tier: metrics.changeLeadTime.tier,
      confidence: metrics.changeLeadTime.confidence,
      source: metrics.changeLeadTime.evidenceSources.join(", "),
      caveats: metrics.changeLeadTime.caveats,
    },
    {
      name: "Recovery Time",
      value: metrics.failedDeploymentRecoveryTime.value
        ? `${metrics.failedDeploymentRecoveryTime.value.medianHours}h`
        : "—",
      tier: metrics.failedDeploymentRecoveryTime.tier,
      confidence: metrics.failedDeploymentRecoveryTime.confidence,
      source: metrics.failedDeploymentRecoveryTime.evidenceSources.join(", "),
      caveats: metrics.failedDeploymentRecoveryTime.caveats,
    },
    {
      name: "Change Fail Rate",
      value: metrics.changeFailRate.value ? `${metrics.changeFailRate.value.percentage}%` : "—",
      tier: metrics.changeFailRate.tier,
      confidence: metrics.changeFailRate.confidence,
      source: metrics.changeFailRate.evidenceSources.join(", "),
      caveats: metrics.changeFailRate.caveats,
    },
    {
      name: "Pipeline Failures",
      value: metrics.pipelineFailureRate.value
        ? `${metrics.pipelineFailureRate.value.percentage}%`
        : "—",
      tier: metrics.pipelineFailureRate.tier,
      confidence: metrics.pipelineFailureRate.confidence,
      source: metrics.pipelineFailureRate.evidenceSources.join(", "),
      caveats: metrics.pipelineFailureRate.caveats,
    },
  ];

  for (const row of rows) {
    const val = row.value.padEnd(8);
    const name = row.name.padEnd(22);
    lines.push(
      `  ${tierIcon(row.tier)} ${white(name)} ${yellow(val)} ${confidenceBadge(row.confidence)} ${dim(row.source)}`,
    );
    for (const c of row.caveats) {
      lines.push(`      ${dim(`⚑ ${c}`)}`);
    }
  }

  // ── Repo profile / signal quality ─────────────────────────────────────────
  lines.push(section("SIGNAL QUALITY"));
  const strength = repoProfile.productionSignalStrength;
  const strengthColor =
    strength === "high" ? green : strength === "medium" ? yellow : strength === "low" ? red : dim;
  lines.push(bullet(strengthColor("◈"), `Production signal strength: ${strengthColor(strength)}`));
  if (!repoProfile.hasDeploymentsApiData) {
    lines.push(bullet(dim("·"), dim("No Deployments API data — using Actions runs as proxy")));
  }
  if (!repoProfile.hasMergedPrHistory) {
    lines.push(bullet(dim("·"), dim("No merged PR history found in lookback window")));
  }
  if (scannedManifests.length > 0) {
    lines.push(bullet(green("✓"), `Scanned manifests: ${scannedManifests.join(", ")}`));
  }

  // ── Security ──────────────────────────────────────────────────────────────
  if (vulnerabilities.length > 0) {
    const crit = vulnerabilities.filter((v) => v.severity === "critical").length;
    const high = vulnerabilities.filter((v) => v.severity === "high").length;
    const med = vulnerabilities.filter((v) => v.severity === "medium").length;
    lines.push(section("SECURITY"));
    if (crit > 0) {
      lines.push(bullet(red("✖"), `${crit} critical vulnerabilities`));
    }
    if (high > 0) {
      lines.push(bullet(yellow("▲"), `${high} high-severity vulnerabilities`));
    }
    if (med > 0) {
      lines.push(bullet(dim("·"), `${med} medium-severity vulnerabilities`));
    }
    for (const v of vulnerabilities
      .filter((x) => x.severity === "critical" || x.severity === "high")
      .slice(0, 5)) {
      lines.push(
        bullet(
          "  ",
          dim(
            `${v.packageName}@${v.currentVersion} — ${v.vulnId}${v.fixedVersion ? ` → fix: ${v.fixedVersion}` : ""}`,
          ),
        ),
      );
    }
  } else {
    lines.push(section("SECURITY"));
    lines.push(bullet(green("✓"), "No known vulnerabilities found in scanned manifests"));
  }

  // ── Fix First ─────────────────────────────────────────────────────────────
  const topActions = recommendations.filter((r) => r.severity === "high").slice(0, 3);
  if (topActions.length > 0) {
    lines.push(section("FIX FIRST"));
    topActions.forEach((rec, i) => {
      lines.push(bullet(cyan(`${i + 1}.`), white(rec.title)));
      lines.push(bullet("  ", dim(rec.description)));
      if (rec.actionItems.length > 0) {
        lines.push(bullet("  ", cyan(`→ ${rec.actionItems[0]}`)));
      }
    });
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push("");
  lines.push(
    dim(
      `  Fetched at ${new Date(result.fetchedAt).toLocaleString()}  ·  Schema v${result.schemaVersion}`,
    ),
  );
  lines.push(
    dim(`  npx delivery-intel ${result.repo.owner}/${result.repo.repo} --json  for full evidence`),
  );
  lines.push("");

  return lines.join("\n");
}
