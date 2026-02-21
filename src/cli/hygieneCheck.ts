// ============================================================================
// Delivery Intel — Engineering Hygiene Check
// ============================================================================
// Automated governance gate that evaluates repository health:
//   1. README.md presence and minimum length
//   2. Test coverage threshold (>80%)
//   3. No PRs >72 hours without review
//
// Produces a structured HygieneReport suitable for Markdown rendering
// (e.g. as a PR comment in CI).
// ============================================================================

import { Octokit } from "@octokit/rest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "fail" | "warn";

export interface HygieneCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface HygieneReport {
  repo: string;
  timestamp: string;
  checks: HygieneCheck[];
  overallStatus: CheckStatus;
  markdownSummary: string;
}

export interface HygieneOptions {
  /** GitHub token for API access */
  token: string;
  /** owner/repo slug */
  repo: string;
  /** Test coverage percentage (0-100). If undefined, skips coverage check. */
  coveragePercent?: number;
  /** Maximum hours a PR can sit without review before flagging (default: 72). */
  maxReviewWaitHours?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_REVIEW_WAIT_HOURS = 72;
const MIN_README_LENGTH = 100;
const COVERAGE_THRESHOLD = 80;

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Check 1: README.md exists and has meaningful content.
 */
export async function checkReadme(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<HygieneCheck> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: "README.md" });
    if ("content" in data && typeof data.content === "string") {
      const decoded = Buffer.from(data.content, "base64").toString("utf8");
      if (decoded.length < MIN_README_LENGTH) {
        return {
          name: "README.md",
          status: "warn",
          detail: `README.md exists but is short (${decoded.length} chars, recommended ≥${MIN_README_LENGTH}).`,
        };
      }
      return {
        name: "README.md",
        status: "pass",
        detail: "README.md is present and has substantive content.",
      };
    }
    return { name: "README.md", status: "fail", detail: "README.md could not be read." };
  } catch {
    return {
      name: "README.md",
      status: "fail",
      detail: "README.md is missing from the repository root.",
    };
  }
}

/**
 * Check 2: Test coverage exceeds threshold.
 */
export function checkCoverage(coveragePercent: number | undefined): HygieneCheck {
  if (coveragePercent === undefined) {
    return {
      name: "Test Coverage",
      status: "warn",
      detail: "Coverage data not provided — skipping check.",
    };
  }

  if (coveragePercent >= COVERAGE_THRESHOLD) {
    return {
      name: "Test Coverage",
      status: "pass",
      detail: `Coverage is ${coveragePercent.toFixed(1)}% (threshold: ${COVERAGE_THRESHOLD}%).`,
    };
  }

  return {
    name: "Test Coverage",
    status: "fail",
    detail: `Coverage is ${coveragePercent.toFixed(1)}%, below the ${COVERAGE_THRESHOLD}% threshold.`,
  };
}

/**
 * Check 3: No open PRs sitting >maxHours without review.
 */
export async function checkStalePRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  maxHours: number,
): Promise<HygieneCheck> {
  try {
    const { data: pulls } = await octokit.pulls.list({
      owner,
      repo,
      state: "open",
      sort: "created",
      direction: "asc",
      per_page: 100,
    });

    const now = Date.now();
    const stalePRs = pulls.filter((pr) => {
      const ageHours = (now - new Date(pr.created_at).getTime()) / (1000 * 60 * 60);
      // A PR is "stale" if it has been open longer than maxHours and still has pending reviewers
      return ageHours > maxHours && (pr.requested_reviewers?.length ?? 0) > 0;
    });

    if (stalePRs.length === 0) {
      return {
        name: "Stale PR Review",
        status: "pass",
        detail: `No open PRs waiting >${maxHours}h for review.`,
      };
    }

    const prList = stalePRs
      .slice(0, 5)
      .map((pr) => `#${pr.number}`)
      .join(", ");
    return {
      name: "Stale PR Review",
      status: "fail",
      detail: `${stalePRs.length} PR(s) waiting >${maxHours}h for review: ${prList}${stalePRs.length > 5 ? "…" : ""}.`,
    };
  } catch {
    return {
      name: "Stale PR Review",
      status: "warn",
      detail: "Could not fetch PR data — skipping stale review check.",
    };
  }
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function statusIcon(status: CheckStatus): string {
  switch (status) {
    case "pass":
      return "✅";
    case "fail":
      return "❌";
    case "warn":
      return "⚠️";
  }
}

export function renderHygieneMarkdown(report: HygieneReport): string {
  const lines: string[] = [];
  const icon = statusIcon(report.overallStatus);

  lines.push(`## ${icon} Engineering Hygiene Report`);
  lines.push("");
  lines.push(`**Repository:** ${report.repo}`);
  lines.push(`**Scanned:** ${report.timestamp}`);
  lines.push(`**Overall:** ${report.overallStatus.toUpperCase()}`);
  lines.push("");
  lines.push("| Check | Status | Detail |");
  lines.push("|-------|--------|--------|");

  for (const check of report.checks) {
    lines.push(
      `| ${check.name} | ${statusIcon(check.status)} ${check.status.toUpperCase()} | ${check.detail} |`,
    );
  }

  lines.push("");

  const failCount = report.checks.filter((c) => c.status === "fail").length;
  if (failCount > 0) {
    lines.push(
      `> **${failCount} check(s) failed.** Address the issues above to improve engineering hygiene.`,
    );
  } else {
    lines.push("> All checks passed. Great engineering hygiene! 🎉");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

function deriveOverallStatus(checks: HygieneCheck[]): CheckStatus {
  if (checks.some((c) => c.status === "fail")) {
    return "fail";
  }
  if (checks.some((c) => c.status === "warn")) {
    return "warn";
  }
  return "pass";
}

/**
 * Run the full Engineering Hygiene audit and produce a report.
 */
export async function runHygieneCheck(options: HygieneOptions): Promise<HygieneReport> {
  const [owner, repo] = options.repo.split("/");
  const maxHours = options.maxReviewWaitHours ?? DEFAULT_MAX_REVIEW_WAIT_HOURS;

  const octokit = new Octokit({ auth: options.token });

  const checks = await Promise.all([
    checkReadme(octokit, owner, repo),
    Promise.resolve(checkCoverage(options.coveragePercent)),
    checkStalePRs(octokit, owner, repo, maxHours),
  ]);

  const overallStatus = deriveOverallStatus(checks);
  const timestamp = new Date().toISOString();

  const report: HygieneReport = {
    repo: options.repo,
    timestamp,
    checks,
    overallStatus,
    markdownSummary: "",
  };

  report.markdownSummary = renderHygieneMarkdown(report);
  return report;
}
