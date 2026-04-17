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

import { analyze } from "./analyzer.js";
import type { AnalysisResult } from "./analyzer.js";
import { renderCyberReport } from "./cyberRenderer.js";
import { withScanSequence } from "./scanSequence.js";
import { writeStepSummary } from "./stepSummary.js";
import { computeRiskScore, type RiskBreakdown } from "./riskEngine.js";
import { generateNarrativeSummary, generateFallbackNarrative } from "./narrativeSummary.js";
import chalk from "chalk";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";

// Resolve absolute path of a binary from a fixed set of known safe directories.
// Using an absolute path eliminates PATH lookup entirely (S4036).
const SAFE_DIRS = ["/usr/local/bin", "/usr/bin", "/bin", "/opt/homebrew/bin", "/opt/local/bin"];
function resolveAbsPath(bin: string): string {
  for (const dir of SAFE_DIRS) {
    const full = `${dir}/${bin}`;
    if (fs.existsSync(full)) {
      return full;
    }
  }
  return bin; // fallback — binary not found in safe dirs
}

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
    // Use absolute path so no PATH lookup occurs — eliminates S4036.
    const token = execFileSync(resolveAbsPath("gh"), ["auth", "token"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return token ?? null;
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

const VERSION = "1.2.0";

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
  ${cyan("npx delivery-intel")} vercel/next.js ${dim("--risk --narrative")}

${bold("OPTIONS")}
  ${chalk.hex("#ffbe0b")("--json")}            Output raw JSON instead of formatted report
  ${chalk.hex("#ffbe0b")("--output <file>")}   Write JSON output to a file
  ${chalk.hex("#ffbe0b")("--token <token>")}   GitHub token (not recommended — prefer gh auth)
  ${chalk.hex("#ffbe0b")("--no-spinner")}      Disable the scanning animation
  ${chalk.hex("#ffbe0b")("--trend")}           Compare last 30 days vs prior 30 days (score deltas)
  ${chalk.hex("#ffbe0b")("--risk")}            Include Burnout Risk Score analysis
  ${chalk.hex("#ffbe0b")("--narrative")}       Generate executive narrative summary (LLM or fallback)
  ${chalk.hex("#ffbe0b")("--help")}            Show this help message
  ${chalk.hex("#ffbe0b")("--version")}         Show version number

${bold("AUTHENTICATION")} ${dim("(token is resolved in this order)")}
  ${green("1. gh auth login")}   ${bold("← Recommended")} (token stays in OS keychain, never exposed)
                      Install: https://cli.github.com
  ${chalk.hex("#ffbe0b")("2. GITHUB_TOKEN")}    Environment variable (OK for CI — use secrets)
  ${red("3. --token")}         Inline flag (avoid — visible in shell history & ps)

${bold("LLM NARRATIVE")} ${dim("(env vars for AI-powered summary)")}
  ${chalk.hex("#ffbe0b")("DELIVERY_INTEL_LLM_API_KEY")}    API key (required for LLM mode)
  ${chalk.hex("#ffbe0b")("DELIVERY_INTEL_LLM_BASE_URL")}   Base URL (default: OpenAI)
  ${chalk.hex("#ffbe0b")("DELIVERY_INTEL_LLM_MODEL")}      Model name (default: gpt-4o-mini)
  ${dim("Without an API key, --narrative uses a template-based fallback.")}

${bold("CI / GITHUB ACTIONS")}
  The built-in $GITHUB_TOKEN is auto-scoped and expires per job:
  ${dim("npx delivery-intel ${{ github.repository }} --token ${{ secrets.GITHUB_TOKEN }}")}
  ${dim("A rich SVG health-score ring is automatically appended to Step Summary.")}

${bold("WHAT IT MEASURES")}
  ${bold("Deploy Frequency")}     How often code ships to production
  ${bold("Lead Time")}            PR creation → merge (branch active duration)
  ${bold("Change Failure Rate")}  % of deployment pipeline runs that failed
  ${bold("Burnout Risk")}         Predictive team strain from velocity/stability deltas
  ${bold("Vulnerabilities")}      OSV.dev scan of dependency manifests
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// Arg parsing (extracted to reduce main() cognitive complexity)
// ---------------------------------------------------------------------------

interface CliArgs {
  jsonMode: boolean;
  noSpinner: boolean;
  riskMode: boolean;
  narrativeMode: boolean;
  trendMode: boolean;
  outputFile: string | null;
  token: string | null;
  repo: string | null;
}

function parseCliArgs(argv: string[]): CliArgs {
  const jsonMode = argv.includes("--json");
  const noSpinner = argv.includes("--no-spinner");
  const riskMode = argv.includes("--risk");
  const narrativeMode = argv.includes("--narrative");
  const trendMode = argv.includes("--trend");
  let outputFile: string | null = null;
  let token: string | null = null;
  let repo: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--output" && argv[i + 1]) {
      i++;
      outputFile = argv[i];
    } else if (argv[i] === "--token" && i + 1 < argv.length) {
      i++;
      token = argv[i] ?? null;
    } else if (!argv[i].startsWith("--")) {
      repo = argv[i];
    }
  }

  return { jsonMode, noSpinner, riskMode, narrativeMode, trendMode, outputFile, token, repo };
}

// ---------------------------------------------------------------------------
// Auth feedback
// ---------------------------------------------------------------------------

function printAuthFeedback(resolved: { source: string } | null): void {
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

// ---------------------------------------------------------------------------
// Narrative resolution
// ---------------------------------------------------------------------------

async function resolveNarrative(
  result: AnalysisResult,
  risk: RiskBreakdown | undefined,
  jsonMode: boolean,
): Promise<{ narrative: string; model: string }> {
  let narrative: string | undefined;
  let model = "template";

  try {
    const llmResult = await generateNarrativeSummary({ analysis: result, risk });
    if (llmResult) {
      narrative = llmResult.narrative;
      model = llmResult.model;
    }
  } catch (llmErr: unknown) {
    if (!jsonMode) {
      const llmMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
      console.log(
        "  " +
          chalk.hex("#ffbe0b")("⚠  LLM narrative failed, using template fallback: ") +
          dim(llmMsg),
      );
    }
  }

  if (!narrative) {
    narrative = generateFallbackNarrative({ analysis: result, risk });
    model = "template";
  }

  return { narrative, model };
}

// ---------------------------------------------------------------------------
// Output handling
// ---------------------------------------------------------------------------

/** Writes serialised JSON to a file and/or stdout based on the active flags. */
function emitJsonOutput(json: string, outputFile: string | null, jsonMode: boolean): void {
  if (outputFile) {
    fs.writeFileSync(outputFile, json, "utf-8");
    if (!jsonMode) {
      console.log("  " + green("✓") + " Report saved to " + bold(outputFile));
    }
  }
  if (jsonMode) {
    console.log(json);
  }
}

function handleOutput(
  result: AnalysisResult,
  opts: {
    jsonMode: boolean;
    outputFile: string | null;
    risk?: RiskBreakdown;
    narrative?: string;
    narrativeModel?: string;
  },
): void {
  if (opts.jsonMode || opts.outputFile) {
    const output = {
      ...result,
      ...(opts.risk ? { riskScore: opts.risk } : {}),
      ...(opts.narrative ? { narrative: opts.narrative } : {}),
    };
    emitJsonOutput(JSON.stringify(output, null, 2), opts.outputFile, opts.jsonMode);
  } else {
    console.log(
      renderCyberReport(result, {
        risk: opts.risk,
        narrative: opts.narrative,
        narrativeModel: opts.narrativeModel,
      }),
    );
  }

  if (process.env.GITHUB_ACTIONS) {
    const wrote = writeStepSummary(result);
    if (wrote && !opts.jsonMode) {
      console.log("  " + green("✓") + " Step Summary written (SVG health ring attached)");
    }
  }
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

  const cli = parseCliArgs(args);
  const resolved = resolveToken(cli.token);
  const token = resolved?.token ?? null;

  if (!cli.repo) {
    console.error(red("Error:") + " No repository specified.");
    console.error(dim("Usage: npx delivery-intel <owner/repo>"));
    process.exit(1);
  }

  if (!cli.jsonMode) {
    printAuthFeedback(resolved);
  }

  try {
    const analysisTask = analyze(cli.repo, token ?? undefined, { withTrend: cli.trendMode });
    const result =
      !cli.jsonMode && !cli.noSpinner ? await withScanSequence(analysisTask) : await analysisTask;

    const risk = cli.riskMode ? computeRiskScore({ doraMetrics: result.doraMetrics }) : undefined;

    let narrative: string | undefined;
    let narrativeModel = "template";
    if (cli.narrativeMode) {
      const nr = await resolveNarrative(result, risk, cli.jsonMode);
      narrative = nr.narrative;
      narrativeModel = nr.model;
    }

    handleOutput(result, {
      jsonMode: cli.jsonMode,
      outputFile: cli.outputFile,
      risk,
      narrative,
      narrativeModel,
    });

    if (result.overallScore < 25) {
      process.exit(2);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red.bold("Error:") + " " + msg);
    process.exit(1);
  }
}

await main();
