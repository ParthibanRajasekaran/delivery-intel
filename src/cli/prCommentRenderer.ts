// ============================================================================
// PR Comment Renderer
// ============================================================================
// Formats the analyzeV2 result as a GitHub-flavoured Markdown PR comment.
// Design principles:
//   - Lead with verdict, not a wall of numbers
//   - Never block on noise — only surface real policy violations
//   - Every data point has visible evidence (source + sample)
//   - Compact by default; expandable via <details> for full evidence
// ============================================================================

import type { AnalysisResultV2 } from "./analyzerV2.js";
import type { PolicyResult, PolicyViolation } from "../domain/policy.js";
import { toLetterGrade } from "../domain/policy.js";

function _severityEmoji(sev: PolicyViolation["severity"]): string {
  if (sev === "blocking") {
    return "🚫";
  }
  if (sev === "warning") {
    return "⚠️";
  }
  return "ℹ️";
}

function tierEmoji(tier: string): string {
  if (tier === "Elite") {
    return "🟢";
  }
  if (tier === "High") {
    return "🟢";
  }
  if (tier === "Medium") {
    return "🟡";
  }
  if (tier === "Low") {
    return "🔴";
  }
  return "⚪";
}

function confidenceLabel(conf: string): string {
  if (conf === "high") {
    return "✅ High";
  }
  if (conf === "medium") {
    return "⚠️ Medium";
  }
  if (conf === "low") {
    return "🔴 Low";
  }
  return "❓ Unknown";
}

/** Write the PR comment body to stdout and, if in GitHub Actions, to GITHUB_STEP_SUMMARY. */
export function renderPRComment(
  result: AnalysisResultV2,
  policy: PolicyResult,
  scoreDelta?: number,
): string {
  const { scores, metrics, vulnerabilities, scannedManifests, recommendations } = result;
  const grade = toLetterGrade(scores.delivery.score);
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`## 🚀 Delivery Health — \`${result.repo.owner}/${result.repo.repo}\``);
  lines.push("");

  // ── Verdict badge line ─────────────────────────────────────────────────────
  const blockingCount = policy.violations.filter((v) => v.severity === "blocking").length;
  const warningCount = policy.violations.filter((v) => v.severity === "warning").length;

  let verdict: string;
  if (policy.shouldBlock) {
    verdict = `🚫 **BLOCKED** — ${blockingCount} blocking violation${blockingCount > 1 ? "s" : ""} must be resolved.`;
  } else if (warningCount > 0) {
    verdict = `⚠️ **No block.** ${warningCount} warning${warningCount > 1 ? "s" : ""} to review.`;
  } else {
    verdict = `✅ **No block.** Delivery health is stable.`;
  }
  lines.push(`> ${verdict}`);
  lines.push("");

  // ── Score summary ──────────────────────────────────────────────────────────
  const trendStr =
    scoreDelta !== undefined
      ? scoreDelta > 0
        ? `↑ +${scoreDelta} pts`
        : scoreDelta < 0
          ? `↓ ${scoreDelta} pts`
          : "→ stable"
      : "—";

  lines.push(`| | Value | |`);
  lines.push(`|---|---|---|`);
  lines.push(`| **Grade** | **${grade}** | ${scores.delivery.score}/100 |`);
  lines.push(`| **Confidence** | ${confidenceLabel(scores.delivery.confidence)} | |`);
  lines.push(`| **Trend** | ${trendStr} | vs. prior 30 days |`);
  lines.push("");

  // ── Scorecard gates ────────────────────────────────────────────────────────
  if (result.scorecard) {
    const sc = result.scorecard;
    const gateIcon = (s: string) => (s === "pass" ? "🟢" : s === "warn" ? "🟡" : "🔴");
    lines.push("### 📋 Scorecard Gates");
    lines.push("");
    lines.push(`| Gate | Status | Evidence Grade |`);
    lines.push(`|------|--------|----------------|`);
    lines.push(
      `| Security Hygiene | ${gateIcon(sc.securityHygiene)} | ${sc.evidenceQuality} (${sc.totalMetricCount - sc.inferredMetricCount}/${sc.totalMetricCount} direct) |`,
    );
    lines.push(`| Flow Health | ${gateIcon(sc.flowHealth)} | |`);
    lines.push(`| Stability | ${gateIcon(sc.stabilityHealth)} | |`);
    lines.push(`| Operational Maturity | ${gateIcon(sc.operationalMaturity)} | |`);
    lines.push("");
  }

  // ── Policy violations ─────────────────────────────────────────────────────
  const blocking = policy.violations.filter((v) => v.severity === "blocking");
  const warnings = policy.violations.filter((v) => v.severity === "warning");
  const infos = policy.violations.filter((v) => v.severity === "info");

  if (blocking.length > 0) {
    lines.push("### 🚫 Blocking Violations");
    for (const v of blocking) {
      lines.push(`- **${v.ruleName}** — ${v.message}`);
      lines.push(`  - Evidence: ${v.evidence}`);
      lines.push(`  - Fix: ${v.fix}`);
    }
    lines.push("");
  }

  if (warnings.length > 0) {
    lines.push("### ⚠️ Warnings");
    for (const v of warnings) {
      lines.push(`- **${v.ruleName}** — ${v.message}`);
      lines.push(`  - Evidence: ${v.evidence}`);
      lines.push(`  - Fix: ${v.fix}`);
    }
    lines.push("");
  }

  if (infos.length > 0) {
    lines.push("### ℹ️ Notes");
    for (const v of infos) {
      lines.push(`- ${v.message}`);
    }
    lines.push("");
  }

  // ── Metrics evidence table (collapsible) ──────────────────────────────────
  lines.push("<details>");
  lines.push("<summary>📊 Metric Details</summary>");
  lines.push("");
  lines.push("| Metric | Value | Tier | Confidence | Source |");
  lines.push("|--------|-------|------|------------|--------|");

  const lt = metrics.changeLeadTime.value;
  const ltHours =
    lt?.primarySignal === "commit_to_deploy" ? lt.commitToDeployMedianHours : lt?.prFlowMedianHours;

  const metricRows = [
    {
      name: "Deployment Frequency",
      value: metrics.deploymentFrequency.value
        ? `${metrics.deploymentFrequency.value.deploymentsPerWeek.toFixed(1)}/wk`
        : "—",
      tier: metrics.deploymentFrequency.tier,
      confidence: metrics.deploymentFrequency.confidence,
      source: metrics.deploymentFrequency.evidenceSources.join(", "),
    },
    {
      name: "Change Lead Time",
      value: ltHours !== null && ltHours !== undefined ? `${ltHours}h` : "—",
      tier: metrics.changeLeadTime.tier,
      confidence: metrics.changeLeadTime.confidence,
      source: metrics.changeLeadTime.evidenceSources.join(", "),
    },
    {
      name: "Recovery Time",
      value: metrics.failedDeploymentRecoveryTime.value
        ? `${metrics.failedDeploymentRecoveryTime.value.medianHours}h median`
        : "—",
      tier: metrics.failedDeploymentRecoveryTime.tier,
      confidence: metrics.failedDeploymentRecoveryTime.confidence,
      source: metrics.failedDeploymentRecoveryTime.evidenceSources.join(", "),
    },
    {
      name: "Change Fail Rate",
      value: metrics.changeFailRate.value ? `${metrics.changeFailRate.value.percentage}%` : "—",
      tier: metrics.changeFailRate.tier,
      confidence: metrics.changeFailRate.confidence,
      source: metrics.changeFailRate.evidenceSources.join(", "),
    },
    {
      name: "Pipeline Failure Rate",
      value: metrics.pipelineFailureRate.value
        ? `${metrics.pipelineFailureRate.value.percentage}%`
        : "—",
      tier: metrics.pipelineFailureRate.tier,
      confidence: metrics.pipelineFailureRate.confidence,
      source: metrics.pipelineFailureRate.evidenceSources.join(", "),
    },
  ];

  for (const row of metricRows) {
    lines.push(
      `| ${row.name} | ${row.value} | ${tierEmoji(row.tier)} ${row.tier} | ${confidenceLabel(row.confidence)} | ${row.source} |`,
    );
  }
  lines.push("");

  // Security summary
  const critical = vulnerabilities.filter((v) => v.severity === "critical").length;
  const high = vulnerabilities.filter((v) => v.severity === "high").length;
  if (vulnerabilities.length > 0) {
    lines.push("**Vulnerabilities**");
    lines.push(`| Severity | Count |`);
    lines.push(`|----------|-------|`);
    if (critical > 0) {
      lines.push(`| 🔴 Critical | ${critical} |`);
    }
    if (high > 0) {
      lines.push(`| 🟠 High | ${high} |`);
    }
    const med = vulnerabilities.filter((v) => v.severity === "medium").length;
    if (med > 0) {
      lines.push(`| 🟡 Medium | ${med} |`);
    }
    lines.push(`| Scanned manifests | ${scannedManifests.join(", ") || "none"} |`);
  } else {
    lines.push(
      `✅ **No vulnerabilities found** in scanned manifests (${scannedManifests.join(", ") || "none"})`,
    );
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");

  // ── Top recommendations ────────────────────────────────────────────────────
  const topRecs = recommendations.filter((r) => r.severity === "high").slice(0, 3);
  if (topRecs.length > 0) {
    lines.push("### 🔧 Fix First");
    for (const rec of topRecs) {
      lines.push(`**${rec.title}** — ${rec.description}`);
      if (rec.actionItems.length > 0) {
        lines.push(`→ ${rec.actionItems[0]}`);
      }
      lines.push("");
    }
  }

  // ── Fix packs ──────────────────────────────────────────────────────────────
  if (result.fixPacks && result.fixPacks.length > 0) {
    const topFixes = result.fixPacks.slice(0, 3);
    lines.push("### 🛠 Fix Packs (auto-generated artifacts)");
    lines.push("");
    for (const fp of topFixes) {
      const artifactList = fp.artifacts.map((a) => `\`${a.filename}\``).join(", ");
      lines.push(`**${fp.finding}** · Effort: ${fp.effort} · Impact: ${fp.impactArea}`);
      lines.push(`→ ${fp.whyItMatters}`);
      if (artifactList) {
        lines.push(`→ Artifacts: ${artifactList}`);
      }
      lines.push("");
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push(`---`);
  lines.push(
    `*delivery-intel · [docs](https://github.com/ParthibanRajasekaran/delivery-intel) · fetched ${new Date(result.fetchedAt).toUTCString()}*`,
  );

  return lines.join("\n");
}

import { execFileSync } from "node:child_process";

/** Post the PR comment via the gh CLI (best-effort, non-fatal). */
export function postPRComment(body: string): void {
  const prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!prNumber || !repo) {
    return;
  }

  try {
    execFileSync("gh", ["pr", "comment", prNumber, "--body", body, "--repo", repo], {
      stdio: "pipe",
      timeout: 15000,
    });
  } catch {
    // Non-fatal — comment posting is best-effort
  }
}
