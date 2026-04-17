// ============================================================================
// Verdict Engine
// ============================================================================
// Assigns a categorical judgment to a repo based on its metrics, forensic
// signals, and vulnerability profile. This transforms numbers into actionable
// language: "Fast but fragile", "Reliable but slow", "Exemplary", etc.
// ============================================================================

import type { MetricSuite, PerformanceTier } from "../domain/metrics.js";
import type { ForensicSignal } from "../domain/forensics.js";
import type {
  RepoVerdict,
  VerdictCategory,
  AnalysisMode,
  TrustVerdict,
  TrustDimension,
  TrustLevel,
} from "../domain/forensics.js";
import { MODE_SIGNAL_WEIGHTS } from "../domain/forensics.js";
import type { DependencyVulnerability } from "../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tierScore(tier: PerformanceTier): number {
  switch (tier) {
    case "Elite":
      return 4;
    case "High":
      return 3;
    case "Medium":
      return 2;
    case "Low":
      return 1;
    case "Unknown":
      return 0;
  }
}

function throughputScore(metrics: MetricSuite): number {
  return (tierScore(metrics.deploymentFrequency.tier) + tierScore(metrics.changeLeadTime.tier)) / 2;
}

function stabilityScore(metrics: MetricSuite): number {
  return (
    (tierScore(metrics.changeFailRate.tier) +
      tierScore(metrics.failedDeploymentRecoveryTime.tier) +
      tierScore(metrics.pipelineFailureRate.tier)) /
    3
  );
}

// ---------------------------------------------------------------------------
// Strength / risk extraction
// ---------------------------------------------------------------------------

function extractStrengths(metrics: MetricSuite, forensics: ForensicSignal[]): string[] {
  const strengths: string[] = [];

  if (tierScore(metrics.deploymentFrequency.tier) >= 3) {
    const freq = metrics.deploymentFrequency.value;
    strengths.push(
      `Strong deployment cadence (${freq ? freq.deploymentsPerWeek.toFixed(1) + "/wk" : "High tier"})`,
    );
  }
  if (tierScore(metrics.changeLeadTime.tier) >= 3) {
    strengths.push("Fast change lead time — code moves from commit to production quickly");
  }
  if (tierScore(metrics.changeFailRate.tier) >= 3) {
    const cfr = metrics.changeFailRate.value;
    strengths.push(
      `Low change failure rate${cfr ? ` (${cfr.percentage}%)` : ""} — changes are well-tested before production`,
    );
  }
  if (tierScore(metrics.failedDeploymentRecoveryTime.tier) >= 3) {
    strengths.push("Fast incident recovery — failures are detected and resolved quickly");
  }
  if (tierScore(metrics.pipelineFailureRate.tier) >= 3) {
    strengths.push("Reliable CI pipeline — builds rarely fail");
  }
  if (forensics.length === 0) {
    strengths.push("No forensic anomalies detected — delivery patterns are healthy");
  }

  return strengths.slice(0, 3);
}

function extractRisks(
  metrics: MetricSuite,
  forensics: ForensicSignal[],
  vulns: DependencyVulnerability[],
): string[] {
  const risks: string[] = [];

  // Forensic signals are the most insightful risks
  for (const signal of forensics.filter((f) => f.severity === "critical")) {
    risks.push(`${signal.title}: ${signal.evidence}`);
  }
  for (const signal of forensics.filter((f) => f.severity === "warning")) {
    risks.push(`${signal.title}: ${signal.evidence}`);
  }

  // Metric-derived risks
  if (tierScore(metrics.deploymentFrequency.tier) <= 1) {
    risks.push("Low deployment frequency — code changes batch up, increasing blast radius");
  }
  if (tierScore(metrics.changeFailRate.tier) <= 1) {
    risks.push("High change failure rate — production deployments frequently need recovery");
  }
  if (tierScore(metrics.failedDeploymentRecoveryTime.tier) <= 1) {
    risks.push("Slow incident recovery — failures take too long to resolve");
  }
  if (tierScore(metrics.pipelineFailureRate.tier) <= 1) {
    risks.push("Unreliable CI pipeline — frequent build failures slow down delivery");
  }

  // Security risks
  const critVulns = vulns.filter((v) => v.severity === "critical").length;
  const highVulns = vulns.filter((v) => v.severity === "high").length;
  if (critVulns > 0) {
    risks.push(`${critVulns} critical vulnerability${critVulns > 1 ? "ies" : "y"} in dependencies`);
  } else if (highVulns > 0) {
    risks.push(
      `${highVulns} high-severity vulnerability${highVulns > 1 ? "ies" : "y"} in dependencies`,
    );
  }

  return risks.slice(0, 3);
}

// ---------------------------------------------------------------------------
// First fix selection
// ---------------------------------------------------------------------------

function pickFirstFix(
  forensics: ForensicSignal[],
  metrics: MetricSuite,
  vulns: DependencyVulnerability[],
): string {
  // Critical forensic signals first
  const criticalSignal = forensics.find((f) => f.severity === "critical");
  if (criticalSignal) {
    return criticalSignal.recommendation;
  }

  // Critical vulnerabilities
  const critVulns = vulns.filter((v) => v.severity === "critical");
  if (critVulns.length > 0) {
    const first = critVulns[0];
    return `Fix critical vulnerability in ${first.packageName}@${first.currentVersion}${first.fixedVersion ? ` — upgrade to ${first.fixedVersion}` : ""}`;
  }

  // Warning forensic signals
  const warningSignal = forensics.find((f) => f.severity === "warning");
  if (warningSignal) {
    return warningSignal.recommendation;
  }

  // Lowest metric tier
  const metricPriority: Array<[string, PerformanceTier, string]> = [
    [
      "Change fail rate",
      metrics.changeFailRate.tier,
      "Add pre-deployment health checks and staging validation",
    ],
    [
      "Recovery time",
      metrics.failedDeploymentRecoveryTime.tier,
      "Build automated rollback workflows triggered by deployment health monitors",
    ],
    [
      "Pipeline reliability",
      metrics.pipelineFailureRate.tier,
      "Stabilise CI pipeline — quarantine flaky tests and fix infrastructure reliability",
    ],
    [
      "Deploy frequency",
      metrics.deploymentFrequency.tier,
      "Automate deployment triggers on merge to reduce manual steps and batch-deploy risk",
    ],
    [
      "Lead time",
      metrics.changeLeadTime.tier,
      "Reduce PR cycle time — smaller PRs, faster reviews, automated deployment on merge",
    ],
  ];

  const worst = metricPriority.sort((a, b) => tierScore(a[1]) - tierScore(b[1]))[0];
  if (tierScore(worst[1]) <= 1) {
    return worst[2];
  }

  return "Continue current practices — delivery health is strong across all dimensions";
}

// ---------------------------------------------------------------------------
// Narrative generation
// ---------------------------------------------------------------------------

function generateNarrative(
  category: VerdictCategory,
  metrics: MetricSuite,
  forensics: ForensicSignal[],
): string {
  const critForensics = forensics.filter((f) => f.severity === "critical").length;
  const warnForensics = forensics.filter((f) => f.severity === "warning").length;

  switch (category) {
    case "exemplary":
      return "This repo demonstrates strong delivery discipline across all dimensions. Throughput is high, failures are rare and quickly recovered, and no forensic anomalies were detected. This is a repo you can trust in CI.";

    case "fast-but-fragile":
      return `Throughput is strong — code ships frequently with low lead time. However, stability metrics reveal fragility: ${
        tierScore(metrics.changeFailRate.tier) <= 1
          ? "high change failure rates"
          : "slow incident recovery"
      } suggests the team pushes fast but doesn't always catch breakage quickly. ${
        critForensics > 0
          ? `${critForensics} critical forensic signal${critForensics > 1 ? "s" : ""} reinforce this pattern.`
          : ""
      }First priority: stabilise before pushing frequency higher.`;

    case "reliable-but-slow":
      return `This repo handles failures well — change fail rates are controlled and recovery is responsive. However, deployment frequency and lead time are lagging, suggesting process bottlenecks, large batch releases, or manual deployment gates. Faster delivery cycles would reduce batch risk without sacrificing the existing stability culture.`;

    case "improving":
      return `Overall delivery health is moderate, but patterns suggest the team is actively improving. ${
        warnForensics > 0
          ? `${warnForensics} forensic warning${warnForensics > 1 ? "s" : ""} remain — address these to sustain momentum.`
          : "Maintain current trajectory."
      }`;

    case "unstable":
      return `This repo shows signs of delivery stress: ${
        tierScore(metrics.changeFailRate.tier) <= 1 ? "high failure rates" : "slow recovery"
      }, ${
        tierScore(metrics.pipelineFailureRate.tier) <= 1
          ? "unreliable CI pipelines"
          : "deployment pattern anomalies"
      }, and ${critForensics + warnForensics} forensic signal${critForensics + warnForensics !== 1 ? "s" : ""}. Focus on stabilisation before adding features.`;

    case "unknown":
      return "Insufficient evidence to confidently assess this repo. Most metrics were inferred from proxy signals. To get an accurate reading, emit deployment events from CI/CD and use the GitHub Deployments API.";
  }
}

// ---------------------------------------------------------------------------
// Headline mapping
// ---------------------------------------------------------------------------

const HEADLINES: Record<VerdictCategory, string> = {
  exemplary: "Exemplary — delivery discipline is strong",
  "fast-but-fragile": "Fast but fragile — ships fast, breaks often",
  "reliable-but-slow": "Reliable but slow — stable delivery, low velocity",
  improving: "Improving — delivery health is trending up",
  unstable: "Unstable — delivery is under stress",
  unknown: "Insufficient evidence — needs better signal",
};

// ---------------------------------------------------------------------------
// Public: compute repo verdict
// ---------------------------------------------------------------------------

export function computeVerdict(
  metrics: MetricSuite,
  forensics: ForensicSignal[],
  vulns: DependencyVulnerability[],
  mode?: AnalysisMode | null,
): RepoVerdict {
  // Adopt mode gets a specialised trust verdict
  if (mode === "adopt") {
    return computeTrustVerdict(metrics, forensics, vulns);
  }

  const throughput = throughputScore(metrics);
  const stability = stabilityScore(metrics);
  const critForensics = forensics.filter((f) => f.severity === "critical").length;

  // Check if most metrics are unknown
  const unknownCount = [
    metrics.deploymentFrequency,
    metrics.changeLeadTime,
    metrics.changeFailRate,
    metrics.failedDeploymentRecoveryTime,
    metrics.pipelineFailureRate,
  ].filter((m) => m.tier === "Unknown").length;

  let category: VerdictCategory;

  if (unknownCount >= 3) {
    category = "unknown";
  } else if (throughput >= 3 && stability >= 3 && critForensics === 0) {
    category = "exemplary";
  } else if (throughput >= 3 && stability < 2) {
    category = "fast-but-fragile";
  } else if (stability >= 3 && throughput < 2) {
    category = "reliable-but-slow";
  } else if (stability < 2 || critForensics >= 2) {
    category = "unstable";
  } else {
    category = "improving";
  }

  // For mode-specific verdicts, filter forensics by mode weight relevance
  const modeWeights = mode ? (MODE_SIGNAL_WEIGHTS[mode] ?? {}) : {};
  const relevantForensics =
    mode && Object.keys(modeWeights).length > 0
      ? forensics.filter((f) => (modeWeights[f.id] ?? 0) > 0)
      : forensics;

  return {
    category,
    headline: HEADLINES[category],
    narrative: generateNarrative(category, metrics, relevantForensics),
    strengths: extractStrengths(metrics, relevantForensics),
    risks: extractRisks(metrics, relevantForensics, vulns),
    firstFix: pickFirstFix(relevantForensics, metrics, vulns),
  };
}

// ---------------------------------------------------------------------------
// Trust verdict for --mode adopt
// ---------------------------------------------------------------------------

function computeTrustDimensions(
  metrics: MetricSuite,
  forensics: ForensicSignal[],
  vulns: DependencyVulnerability[],
): TrustDimension[] {
  const adoptWeights = MODE_SIGNAL_WEIGHTS.adopt;

  // Maintenance freshness
  const freshnessSignal = forensics.find((f) => f.id === "freshness-cadence");
  const freshnessScore = freshnessSignal ? (freshnessSignal.severity === "critical" ? 10 : 40) : 90;

  // CI reliability
  const ciSignal = forensics.find((f) => f.id === "ci-flakiness");
  const flakySignal = forensics.find((f) => f.id === "flaky-pipeline");
  const ciScore = ciSignal
    ? ciSignal.severity === "critical"
      ? 15
      : 45
    : flakySignal
      ? 50
      : tierScore(metrics.pipelineFailureRate.tier) * 25;

  // Vulnerability exposure
  const vulnSignal = forensics.find((f) => f.id === "dependency-exposure");
  const critVulns = vulns.filter((v) => v.severity === "critical").length;
  const vulnScore = critVulns > 0 ? 10 : vulnSignal ? 40 : 90;

  // Release hygiene
  const releaseSignal = forensics.find((f) => f.id === "release-hygiene");
  const releaseScore = releaseSignal ? (releaseSignal.severity === "warning" ? 30 : 60) : 85;

  // Contributor concentration
  const maintainerSignal = forensics.find((f) => f.id === "maintainer-concentration");
  const maintainerScore = maintainerSignal
    ? maintainerSignal.severity === "critical"
      ? 15
      : 45
    : 85;

  // Change safety (composite of CFR + rollback signal + recovery)
  const rollbackSignal = forensics.find((f) => f.id === "rollback-signal");
  const changeSafetyBase =
    (tierScore(metrics.changeFailRate.tier) * 25 +
      tierScore(metrics.failedDeploymentRecoveryTime.tier) * 25) /
    2;
  const changeSafetyScore = rollbackSignal ? Math.max(changeSafetyBase - 20, 0) : changeSafetyBase;

  return [
    {
      name: "Maintenance freshness",
      score: freshnessScore,
      weight: adoptWeights["freshness-cadence"] ?? 0.8,
      signals: freshnessSignal ? [freshnessSignal.evidence] : ["Repository is actively maintained"],
    },
    {
      name: "CI reliability",
      score: ciScore,
      weight: adoptWeights["ci-flakiness"] ?? 0.7,
      signals: [ciSignal, flakySignal].filter(Boolean).map((s) => s!.evidence),
    },
    {
      name: "Vulnerability exposure",
      score: vulnScore,
      weight: adoptWeights["dependency-exposure"] ?? 0.9,
      signals: vulnSignal
        ? [vulnSignal.evidence]
        : vulns.length > 0
          ? [`${vulns.length} known vulnerabilities (no critical)`]
          : ["No known vulnerabilities"],
    },
    {
      name: "Release hygiene",
      score: releaseScore,
      weight: adoptWeights["release-hygiene"] ?? 0.6,
      signals: releaseSignal ? [releaseSignal.evidence] : ["Releases follow semantic versioning"],
    },
    {
      name: "Contributor concentration",
      score: maintainerScore,
      weight: adoptWeights["maintainer-concentration"] ?? 0.7,
      signals: maintainerSignal
        ? [maintainerSignal.evidence]
        : ["Contributions are distributed across multiple maintainers"],
    },
    {
      name: "Change safety",
      score: changeSafetyScore,
      weight: 0.7,
      signals: rollbackSignal
        ? [rollbackSignal.evidence]
        : changeSafetyBase >= 75
          ? ["Low change failure rate with fast recovery"]
          : ["Change failure rate or recovery time could improve"],
    },
  ];
}

function computeTrustScore(dimensions: TrustDimension[]): number {
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0) {
    return 0;
  }
  const weighted = dimensions.reduce((s, d) => s + d.score * d.weight, 0);
  return Math.round(weighted / totalWeight);
}

function trustLevel(score: number, unknowns: number): TrustLevel {
  if (unknowns >= 3) {
    return "insufficient-evidence";
  }
  if (score >= 75) {
    return "high";
  }
  if (score >= 45) {
    return "moderate";
  }
  return "low";
}

function trustHeadline(level: TrustLevel): string {
  switch (level) {
    case "high":
      return "Safe to adopt — strong evidence of healthy delivery";
    case "moderate":
      return "Adopt with caution — some risk factors detected";
    case "low":
      return "High risk — significant concerns found";
    case "insufficient-evidence":
      return "Cannot assess — insufficient evidence available";
  }
}

function trustNarrative(
  level: TrustLevel,
  dimensions: TrustDimension[],
  forensics: ForensicSignal[],
): string {
  const weakDims = dimensions.filter((d) => d.score < 50);
  const strongDims = dimensions.filter((d) => d.score >= 75);

  switch (level) {
    case "high":
      return (
        `This repository shows strong delivery discipline across ${strongDims.length} of ${dimensions.length} trust dimensions. ` +
        `It is actively maintained, CI is reliable, and no critical security issues were found. Safe to depend on.`
      );
    case "moderate":
      return (
        `This repository has ${weakDims.length} area${weakDims.length !== 1 ? "s" : ""} of concern: ` +
        `${weakDims.map((d) => d.name.toLowerCase()).join(", ")}. ` +
        `${forensics.filter((f) => f.severity !== "info").length} forensic signals suggest caution. ` +
        `Consider the risks before adopting.`
      );
    case "low":
      return (
        `Significant risk factors detected: ${weakDims.map((d) => d.name.toLowerCase()).join(", ")}. ` +
        `${forensics.filter((f) => f.severity === "critical").length} critical signals found. ` +
        `This repo requires substantial due diligence before adoption.`
      );
    case "insufficient-evidence":
      return (
        `Most metrics were inferred from proxy signals. Insufficient evidence to confidently assess ` +
        `whether this repository is safe to adopt. Look for deployment events, releases, and CI history.`
      );
  }
}

function computeTrustVerdict(
  metrics: MetricSuite,
  forensics: ForensicSignal[],
  vulns: DependencyVulnerability[],
): TrustVerdict {
  const dimensions = computeTrustDimensions(metrics, forensics, vulns);
  const score = computeTrustScore(dimensions);

  const unknownCount = [
    metrics.deploymentFrequency,
    metrics.changeLeadTime,
    metrics.changeFailRate,
    metrics.failedDeploymentRecoveryTime,
    metrics.pipelineFailureRate,
  ].filter((m) => m.tier === "Unknown").length;

  const level = trustLevel(score, unknownCount);

  // Map trust level to verdict category
  const categoryMap: Record<TrustLevel, VerdictCategory> = {
    high: "exemplary",
    moderate: "improving",
    low: "unstable",
    "insufficient-evidence": "unknown",
  };

  return {
    category: categoryMap[level],
    headline: trustHeadline(level),
    narrative: trustNarrative(level, dimensions, forensics),
    strengths: extractStrengths(metrics, forensics),
    risks: extractRisks(metrics, forensics, vulns),
    firstFix: pickFirstFix(forensics, metrics, vulns),
    trustLevel: level,
    trustScore: score,
    trustDimensions: dimensions,
  };
}
