#!/usr/bin/env node
// ============================================================================
// delivery-intel CLI
// ============================================================================
// Usage:
//   npx delivery-intel <owner/repo>
//   npx delivery-intel vercel/next.js
//   npx delivery-intel https://github.com/facebook/react
//   npx delivery-intel vercel/next.js --json
//   npx delivery-intel vercel/next.js --json --output report.json
// ============================================================================

import { analyze } from "./analyzer";
import type {
  AnalysisResult,
  DORAMetrics,
  DependencyVulnerability,
  Suggestion,
} from "./analyzer";
import * as fs from "fs";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Secure token resolution
// ---------------------------------------------------------------------------
// Priority order:
//   1. --token flag (explicit, least recommended)
//   2. GITHUB_TOKEN env var
//   3. gh auth token (GitHub CLI — recommended, token stays in OS keychain)
// ---------------------------------------------------------------------------

function resolveTokenFromGHCli(): string | null {
  try {
    const token = execSync("gh auth token", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return token || null;
  } catch {
    return null;
  }
}

function resolveToken(explicitToken: string | null): {
  token: string;
  source: string;
} | null {
  if (explicitToken) {
    return { token: explicitToken, source: "--token flag" };
  }
  if (process.env.GITHUB_TOKEN) {
    return { token: process.env.GITHUB_TOKEN, source: "GITHUB_TOKEN env var" };
  }
  const ghToken = resolveTokenFromGHCli();
  if (ghToken) {
    return { token: ghToken, source: "GitHub CLI (gh auth token)" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  gray: "\x1b[90m",
};

function ratingColor(rating: string): string {
  switch (rating) {
    case "Elite": return c.green;
    case "High": return c.blue;
    case "Medium": return c.yellow;
    case "Low": return c.red;
    default: return c.dim;
  }
}

function severityColor(sev: string): string {
  switch (sev) {
    case "critical": return c.bgRed + c.white;
    case "high": return c.red;
    case "medium": return c.yellow;
    case "low": return c.blue;
    default: return c.dim;
  }
}

// ---------------------------------------------------------------------------
// Score bar visualization
// ---------------------------------------------------------------------------

function scoreBar(score: number): string {
  const width = 30;
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  let barColor = c.red;
  if (score >= 75) {barColor = c.green;}
  else if (score >= 50) {barColor = c.yellow;}
  else if (score >= 25) {barColor = c.blue;}

  return (
    barColor + "█".repeat(filled) + c.dim + "░".repeat(empty) + c.reset +
    ` ${c.bold}${score}${c.reset}${c.dim}/100${c.reset}`
  );
}

// ---------------------------------------------------------------------------
// Pretty-print sections
// ---------------------------------------------------------------------------

function printHeader(result: AnalysisResult): void {
  console.log();
  console.log(
    `${c.bold}${c.cyan}  ┌─────────────────────────────────────────────────┐${c.reset}`
  );
  console.log(
    `${c.bold}${c.cyan}  │${c.reset}  ${c.bold}📊 Delivery Intel${c.reset}  ${c.dim}— Software Delivery Intelligence${c.reset}  ${c.bold}${c.cyan}│${c.reset}`
  );
  console.log(
    `${c.bold}${c.cyan}  └─────────────────────────────────────────────────┘${c.reset}`
  );
  console.log();
  console.log(
    `  ${c.dim}Repository:${c.reset}  ${c.bold}${result.repo.owner}/${result.repo.repo}${c.reset}`
  );
  console.log(`  ${c.dim}Analyzed:${c.reset}    ${result.fetchedAt}`);
  console.log();
}

function printScore(score: number): void {
  console.log(`  ${c.bold}Overall Health Score${c.reset}`);
  console.log(`  ${scoreBar(score)}`);
  console.log();
}

function printDORA(dora: DORAMetrics): void {
  console.log(
    `  ${c.bold}DORA Metrics${c.reset}  ${c.dim}─────────────────────────────────────${c.reset}`
  );
  console.log();

  // Deploy Frequency
  const df = dora.deploymentFrequency;
  console.log(
    `  ${c.bold}Deploy Frequency${c.reset}  ${ratingColor(df.rating)}${df.rating}${c.reset}`
  );
  console.log(
    `  ${c.dim}How often code ships to production${c.reset}`
  );
  console.log(
    `  ${c.bold}${df.deploymentsPerWeek}${c.reset} ${c.dim}deployments/week${c.reset}  ${c.gray}(source: ${df.source === "merged_prs_fallback" ? "merged PRs" : "Deployments API"})${c.reset}`
  );
  console.log();

  // Lead Time
  const lt = dora.leadTimeForChanges;
  console.log(
    `  ${c.bold}Lead Time${c.reset}  ${ratingColor(lt.rating)}${lt.rating}${c.reset}`
  );
  console.log(
    `  ${c.dim}Time from PR creation to merge (branch active duration)${c.reset}`
  );
  console.log(
    `  ${c.bold}${lt.medianHours}${c.reset} ${c.dim}hours median${c.reset}  ${c.gray}(${(lt.medianHours / 24).toFixed(1)} days)${c.reset}`
  );
  console.log();

  // Change Failure Rate
  const cfr = dora.changeFailureRate;
  console.log(
    `  ${c.bold}Change Failure Rate${c.reset}  ${ratingColor(cfr.rating)}${cfr.rating}${c.reset}`
  );
  console.log(
    `  ${c.dim}Percentage of deployment pipeline runs that failed${c.reset}`
  );
  console.log(
    `  ${c.bold}${cfr.percentage}%${c.reset}  ${c.gray}(${cfr.failedRuns} failed / ${cfr.totalRuns} total pipeline runs)${c.reset}`
  );
  console.log();
}

function printVulnerabilities(vulns: DependencyVulnerability[]): void {
  console.log(
    `  ${c.bold}Vulnerability Scan${c.reset}  ${c.dim}(OSV.dev)${c.reset}  ${c.dim}───────────────────${c.reset}`
  );
  console.log();

  if (vulns.length === 0) {
    console.log(`  ${c.green}✓ No known vulnerabilities found${c.reset}`);
    console.log();
    return;
  }

  console.log(
    `  ${c.red}${c.bold}${vulns.length}${c.reset}${c.red} vulnerabilit${vulns.length === 1 ? "y" : "ies"} found${c.reset}`
  );
  console.log();

  // Group by severity
  const grouped: Record<string, DependencyVulnerability[]> = {};
  for (const v of vulns) {
    if (!grouped[v.severity]) {grouped[v.severity] = [];}
    grouped[v.severity].push(v);
  }

  const order = ["critical", "high", "medium", "low", "unknown"];
  for (const sev of order) {
    const list = grouped[sev];
    if (!list) {continue;}
    console.log(
      `  ${severityColor(sev)} ${sev.toUpperCase()} ${c.reset} ${c.dim}(${list.length})${c.reset}`
    );
    for (const v of list.slice(0, 5)) {
      const fix = v.fixedVersion
        ? `${c.green}→ ${v.fixedVersion}${c.reset}`
        : `${c.dim}no fix${c.reset}`;
      console.log(
        `    ${c.dim}•${c.reset} ${v.packageName}${c.dim}@${v.currentVersion}${c.reset}  ${v.vulnId}  ${fix}`
      );
    }
    if (list.length > 5) {
      console.log(`    ${c.dim}  + ${list.length - 5} more${c.reset}`);
    }
  }
  console.log();
}

function printSuggestions(suggestions: Suggestion[]): void {
  console.log(
    `  ${c.bold}Suggestions${c.reset}  ${c.dim}────────────────────────────────────${c.reset}`
  );
  console.log();

  for (const s of suggestions) {
    const icon =
      s.category === "security" ? "🔒" : s.category === "reliability" ? "🛡️ " : "⚡";
    const sevTag = `${severityColor(s.severity)} ${s.severity.toUpperCase()} ${c.reset}`;
    console.log(`  ${icon} ${sevTag} ${c.bold}${s.title}${c.reset}`);
    console.log(`  ${c.dim}${s.description}${c.reset}`);
    for (const action of s.actionItems) {
      console.log(`    ${c.cyan}→${c.reset} ${action}`);
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Help & Version
// ---------------------------------------------------------------------------

const VERSION = "1.0.0";

function printHelp(): void {
  console.log(`
${c.bold}delivery-intel${c.reset} v${VERSION}
${c.dim}Software Delivery Intelligence for any GitHub repository${c.reset}

${c.bold}USAGE${c.reset}
  ${c.cyan}npx delivery-intel${c.reset} <owner/repo> [options]

${c.bold}EXAMPLES${c.reset}
  ${c.cyan}npx delivery-intel${c.reset} vercel/next.js
  ${c.cyan}npx delivery-intel${c.reset} https://github.com/facebook/react
  ${c.cyan}npx delivery-intel${c.reset} vercel/next.js ${c.dim}--json${c.reset}
  ${c.cyan}npx delivery-intel${c.reset} vercel/next.js ${c.dim}--json --output report.json${c.reset}

${c.bold}OPTIONS${c.reset}
  ${c.yellow}--json${c.reset}            Output raw JSON instead of formatted report
  ${c.yellow}--output <file>${c.reset}   Write JSON output to a file
  ${c.yellow}--token <token>${c.reset}   GitHub token (not recommended — prefer gh auth)
  ${c.yellow}--help${c.reset}            Show this help message
  ${c.yellow}--version${c.reset}         Show version number

${c.bold}AUTHENTICATION${c.reset} ${c.dim}(token is resolved in this order)${c.reset}
  ${c.green}1. gh auth login${c.reset}   ${c.bold}← Recommended${c.reset} (token stays in OS keychain, never exposed)
                      Install: https://cli.github.com
  ${c.yellow}2. GITHUB_TOKEN${c.reset}    Environment variable (OK for CI — use secrets)
  ${c.red}3. --token${c.reset}         Inline flag (avoid — visible in shell history & ps)

${c.bold}CI / GITHUB ACTIONS${c.reset}
  The built-in $GITHUB_TOKEN is auto-scoped and expires per job:
  ${c.dim}npx delivery-intel \${{ github.repository }} --token \${{ secrets.GITHUB_TOKEN }}${c.reset}

${c.bold}WHAT IT MEASURES${c.reset}
  ${c.bold}Deploy Frequency${c.reset}     How often code ships to production
  ${c.bold}Lead Time${c.reset}            PR creation → merge (branch active duration)
  ${c.bold}Change Failure Rate${c.reset}  % of deployment pipeline runs that failed
  ${c.bold}Vulnerabilities${c.reset}      OSV.dev scan of dependency manifests
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  // Parse args
  const jsonMode = args.includes("--json");
  let outputFile: string | null = null;
  let token: string | null = null;
  let repo: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputFile = args[++i];
    } else if (args[i] === "--token" && i + 1 < args.length) {
      token = args[++i] || null;
    } else if (!args[i].startsWith("--")) {
      repo = args[i];
    }
  }

  const resolved = resolveToken(token);
  if (resolved) {
    token = resolved.token;
  } else {
    token = null;
  }

  if (!repo) {
    console.error(`${c.red}Error:${c.reset} No repository specified.`);
    console.error(`${c.dim}Usage: npx delivery-intel <owner/repo>${c.reset}`);
    process.exit(1);
  }

  // Run analysis
  if (!jsonMode) {
    console.log();
    console.log(
      `  ${c.dim}Analyzing ${c.reset}${c.bold}${repo}${c.reset}${c.dim}...${c.reset}`
    );
    if (resolved) {
      console.log(
        `  ${c.dim}Auth: ${resolved.source}${c.reset}`
      );
    } else {
      console.log(
        `  ${c.yellow}⚠  No token — using unauthenticated mode (60 req/hr, public repos only)${c.reset}`
      );
      console.log(
        `  ${c.dim}Tip: run ${c.cyan}gh auth login${c.dim} for 5,000 req/hr + private repo access${c.reset}`
      );
    }
  }

  try {
    const result = await analyze(repo, token || undefined);

    if (jsonMode || outputFile) {
      const json = JSON.stringify(result, null, 2);
      if (outputFile) {
        fs.writeFileSync(outputFile, json, "utf-8");
        if (!jsonMode) {
          console.log(`  ${c.green}✓${c.reset} Report saved to ${c.bold}${outputFile}${c.reset}`);
        }
      }
      if (jsonMode) {
        console.log(json);
      }
    } else {
      printHeader(result);
      printScore(result.overallScore);
      printDORA(result.doraMetrics);
      printVulnerabilities(result.vulnerabilities);
      printSuggestions(result.suggestions);
    }

    // Exit code based on score
    if (result.overallScore < 25) {process.exit(2);}
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${c.red}Error:${c.reset} ${msg}`);
    process.exit(1);
  }
}

main();
