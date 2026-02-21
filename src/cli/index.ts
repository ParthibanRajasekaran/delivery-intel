#!/usr/bin/env node
// ============================================================================
// delivery-intel CLI  — Cyber-Diagnostic Edition 2026
// ============================================================================
// Usage:
//   npx delivery-intel <owner/repo>
//   npx delivery-intel vercel/next.js
//   npx delivery-intel https://github.com/facebook/react
//   npx delivery-intel vercel/next.js --json
//   npx delivery-intel vercel/next.js --json --output report.json
// ============================================================================

import { analyze } from "./analyzer";
import type { AnalysisResult } from "./analyzer";
import { renderCyberReport } from "./cyberRenderer";
import { withScanSequence } from "./scanSequence";
import { writeStepSummary } from "./stepSummary";
import chalk from "chalk";
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
// Palette shortcuts
// ---------------------------------------------------------------------------

const cyan = chalk.hex("#00f2fe");
const green = chalk.hex("#39ff14");
const red = chalk.hex("#ff073a");
const dim = chalk.gray;
const bold = chalk.bold.white;

// ---------------------------------------------------------------------------
// Help & Version
// ---------------------------------------------------------------------------

const VERSION = "1.1.0";

function printHelp(): void {
  console.log(`
${bold("delivery-intel")} ${dim(`v${VERSION}`)}  ${cyan("— Cyber-Diagnostic Edition")}
${dim("Software Delivery Intelligence for any GitHub repository")}

${bold("USAGE")}
  ${cyan("npx delivery-intel")} <owner/repo> [options]

${bold("EXAMPLES")}
  ${cyan("npx delivery-intel")} vercel/next.js
  ${cyan("npx delivery-intel")} https://github.com/facebook/react
  ${cyan("npx delivery-intel")} vercel/next.js ${dim("--json")}
  ${cyan("npx delivery-intel")} vercel/next.js ${dim("--json --output report.json")}

${bold("OPTIONS")}
  ${chalk.hex("#ffbe0b")("--json")}            Output raw JSON instead of formatted report
  ${chalk.hex("#ffbe0b")("--output <file>")}   Write JSON output to a file
  ${chalk.hex("#ffbe0b")("--token <token>")}   GitHub token (not recommended — prefer gh auth)
  ${chalk.hex("#ffbe0b")("--no-spinner")}      Disable the scanning animation
  ${chalk.hex("#ffbe0b")("--help")}            Show this help message
  ${chalk.hex("#ffbe0b")("--version")}         Show version number

${bold("AUTHENTICATION")} ${dim("(token is resolved in this order)")}
  ${green("1. gh auth login")}   ${bold("← Recommended")} (token stays in OS keychain, never exposed)
                      Install: https://cli.github.com
  ${chalk.hex("#ffbe0b")("2. GITHUB_TOKEN")}    Environment variable (OK for CI — use secrets)
  ${red("3. --token")}         Inline flag (avoid — visible in shell history & ps)

${bold("CI / GITHUB ACTIONS")}
  The built-in $GITHUB_TOKEN is auto-scoped and expires per job:
  ${dim("npx delivery-intel ${{ github.repository }} --token ${{ secrets.GITHUB_TOKEN }}")}
  ${dim("A rich SVG health-score ring is automatically appended to Step Summary.")}

${bold("WHAT IT MEASURES")}
  ${bold("Deploy Frequency")}     How often code ships to production
  ${bold("Lead Time")}            PR creation → merge (branch active duration)
  ${bold("Change Failure Rate")}  % of deployment pipeline runs that failed
  ${bold("Vulnerabilities")}      OSV.dev scan of dependency manifests
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
  const noSpinner = args.includes("--no-spinner");
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
    console.error(red("Error:") + " No repository specified.");
    console.error(dim("Usage: npx delivery-intel <owner/repo>"));
    process.exit(1);
  }

  // Pre-analysis auth feedback (only in human-readable mode)
  if (!jsonMode) {
    console.log();
    if (resolved) {
      console.log("  " + dim(`Auth: ${resolved.source}`));
    } else {
      console.log(
        "  " +
          chalk.hex("#ffbe0b")(
            "⚠  No token — using unauthenticated mode (60 req/hr, public repos only)",
          ),
      );
      console.log(
        "  " +
          dim("Tip: run ") +
          cyan("gh auth login") +
          dim(" for 5,000 req/hr + private repo access"),
      );
    }
    console.log();
  }

  try {
    // Run analysis — with or without spinner
    let result: AnalysisResult;
    const analysisTask = analyze(repo, token || undefined);

    if (!jsonMode && !noSpinner) {
      result = await withScanSequence(analysisTask);
    } else {
      result = await analysisTask;
    }

    // ---- JSON output (machine-readable, unstyled) -----------------------
    if (jsonMode || outputFile) {
      const json = JSON.stringify(result, null, 2);
      if (outputFile) {
        fs.writeFileSync(outputFile, json, "utf-8");
        if (!jsonMode) {
          console.log("  " + green("✓") + " Report saved to " + bold(outputFile));
        }
      }
      if (jsonMode) {
        console.log(json);
      }
    } else {
      // ---- Cyber-Diagnostic human output --------------------------------
      console.log(renderCyberReport(result));
    }

    // ---- GitHub Actions Step Summary ------------------------------------
    if (process.env.GITHUB_ACTIONS) {
      const wrote = writeStepSummary(result);
      if (wrote && !jsonMode) {
        console.log("  " + green("✓") + " Step Summary written (SVG health ring attached)");
      }
    }

    // Exit code based on score
    if (result.overallScore < 25) {
      process.exit(2);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red.bold("Error:") + " " + msg);
    process.exit(1);
  }
}

main();
