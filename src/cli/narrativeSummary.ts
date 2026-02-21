// ============================================================================
// Delivery Intel — Executive Narrative Summary (LLM Integration)
// ============================================================================
// Sends DORA metrics JSON to an LLM (OpenAI-compatible API) with a
// CTO-focused prompt that translates numbers into actionable prose.
//
// Supports: OpenAI, Azure OpenAI, Gemini (via OpenAI-compatible endpoint),
// and any provider exposing a /chat/completions endpoint.
//
// Configuration via environment variables:
//   DELIVERY_INTEL_LLM_API_KEY   — API key (required)
//   DELIVERY_INTEL_LLM_BASE_URL  — base URL (default: https://api.openai.com/v1)
//   DELIVERY_INTEL_LLM_MODEL     — model name (default: gpt-4o-mini)
// ============================================================================

import type { AnalysisResult } from "./analyzer.js";
import type { RiskBreakdown } from "./riskEngine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NarrativeInput {
  analysis: AnalysisResult;
  risk?: RiskBreakdown;
}

export interface NarrativeResult {
  narrative: string;
  model: string;
  tokensUsed?: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: { content: string };
  }>;
  model: string;
  usage?: { total_tokens: number };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function loadLLMConfig(): LLMConfig | null {
  const apiKey = process.env.DELIVERY_INTEL_LLM_API_KEY;
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: process.env.DELIVERY_INTEL_LLM_BASE_URL ?? "https://api.openai.com/v1",
    model: process.env.DELIVERY_INTEL_LLM_MODEL ?? "gpt-4o-mini",
  };
}

// ---------------------------------------------------------------------------
// Prompt engineering
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an elite engineering advisor writing for a CTO audience.
Given DORA metrics and optional risk data for a repository, produce a concise
executive narrative (3-5 paragraphs) that:

1. Leads with the overall delivery health verdict (healthy, at-risk, or degraded).
2. Highlights wins in deployment velocity and stability.
3. Flags bottlenecks — especially in the "Build → Review → Merge" pipeline.
4. Quantifies improvement opportunities (e.g. "reducing median lead time from
   48h to 24h would move the team from 'Medium' to 'Elite'").
5. Ends with 2-3 prioritized action items.

Use a professional but direct tone. Avoid jargon. Reference specific numbers
from the metrics. Do NOT invent data — only use what is provided.`;

export function buildUserPrompt(input: NarrativeInput): string {
  const parts: string[] = [];
  const { analysis, risk } = input;

  parts.push("## Repository");
  parts.push(`${analysis.repo.owner}/${analysis.repo.repo}`);
  parts.push("");

  parts.push("## DORA Metrics");
  parts.push(JSON.stringify(analysis.doraMetrics, null, 2));
  parts.push("");

  parts.push("## Overall Score");
  parts.push(`${analysis.overallScore}/100`);
  parts.push("");

  if (analysis.vulnerabilities.length > 0) {
    parts.push("## Vulnerabilities");
    parts.push(`${analysis.vulnerabilities.length} dependency vulnerability(ies) detected.`);
    const bySev: Record<string, number> = {};
    for (const v of analysis.vulnerabilities) {
      bySev[v.severity] = (bySev[v.severity] ?? 0) + 1;
    }
    parts.push(JSON.stringify(bySev));
    parts.push("");
  }

  if (analysis.suggestions.length > 0) {
    parts.push("## Top Suggestions");
    for (const s of analysis.suggestions.slice(0, 5)) {
      parts.push(`- [${s.severity.toUpperCase()}] ${s.title}: ${s.description}`);
    }
    parts.push("");
  }

  if (risk) {
    parts.push("## Burnout Risk Score");
    parts.push(`Score: ${risk.score}/100 (${risk.level})`);
    parts.push(`Cycle Time Delta: ${risk.cycleTimeDelta}`);
    parts.push(`Failure Rate Delta: ${risk.failureRateDelta}`);
    parts.push(`Sentiment Multiplier: ${risk.sentimentMultiplier}`);
    parts.push(`Summary: ${risk.summary}`);
    parts.push("");
  }

  parts.push("## Daily Deployments (last 7 days, oldest→newest)");
  parts.push(analysis.dailyDeployments.join(", "));

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// LLM API call
// ---------------------------------------------------------------------------

/**
 * Call an OpenAI-compatible /chat/completions endpoint.
 */
const LLM_TIMEOUT_MS = 60_000;

async function chatCompletion(
  config: LLMConfig,
  messages: ChatMessage[],
): Promise<ChatCompletionResponse> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  // Enforce a maximum duration so CLI/CI runs cannot hang indefinitely
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, LLM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.4,
        max_tokens: 1024,
      }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `LLM API request to ${url} timed out after ${LLM_TIMEOUT_MS}ms. ` +
          "Check network connectivity or try again.",
        { cause: err },
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM API error ${response.status}: ${body}`);
  }

  return (await response.json()) as ChatCompletionResponse;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an executive narrative summary from DORA metrics via an LLM.
 *
 * Returns `null` if LLM is not configured (missing API key) — callers should
 * fall back gracefully.
 */
export async function generateNarrativeSummary(
  input: NarrativeInput,
  configOverride?: LLMConfig,
): Promise<NarrativeResult | null> {
  const config = configOverride ?? loadLLMConfig();
  if (!config) {
    return null;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(input) },
  ];

  const completion = await chatCompletion(config, messages);

  const narrative = completion.choices?.[0]?.message?.content?.trim() ?? "";
  if (!narrative) {
    throw new Error("LLM returned an empty response.");
  }

  return {
    narrative,
    model: completion.model ?? config.model,
    tokensUsed: completion.usage?.total_tokens,
  };
}

/**
 * Generate a fallback narrative when LLM is not available.
 * Uses template-based generation from the raw metrics.
 */
export function generateFallbackNarrative(input: NarrativeInput): string {
  const { analysis, risk } = input;
  const { doraMetrics, overallScore } = analysis;
  const lines: string[] = [];

  // Verdict
  let verdict: string;
  if (overallScore >= 80) {
    verdict = "healthy";
  } else if (overallScore >= 50) {
    verdict = "at-risk";
  } else {
    verdict = "degraded";
  }
  lines.push(`**Delivery Health: ${verdict.toUpperCase()}** (${overallScore}/100)`);
  lines.push("");

  // DORA summary
  const leadTimeText =
    doraMetrics.leadTimeForChanges.rating === "N/A"
      ? "no lead time data available"
      : `a median lead time of ${doraMetrics.leadTimeForChanges.medianHours.toFixed(1)} hours (${doraMetrics.leadTimeForChanges.rating})`;
  const cfrText =
    doraMetrics.changeFailureRate.rating === "N/A"
      ? "no CI run data available"
      : `${doraMetrics.changeFailureRate.percentage.toFixed(1)}% (${doraMetrics.changeFailureRate.rating})`;
  lines.push(
    `The team is deploying ${doraMetrics.deploymentFrequency.deploymentsPerWeek.toFixed(1)} times per week (${doraMetrics.deploymentFrequency.rating}) with ${leadTimeText}. The change failure rate sits at ${cfrText}.`,
  );
  lines.push("");

  // Risk
  if (risk) {
    lines.push(`The Burnout Risk Score is ${risk.score}/100 (${risk.level}). ${risk.summary}`);
    lines.push("");
  }

  // Vulnerabilities
  if (analysis.vulnerabilities.length > 0) {
    lines.push(
      `There are ${analysis.vulnerabilities.length} dependency vulnerabilities that need attention.`,
    );
    lines.push("");
  }

  // Top suggestion
  if (analysis.suggestions.length > 0) {
    lines.push(
      "**Top Priority:** " +
        analysis.suggestions[0].title +
        " — " +
        analysis.suggestions[0].description,
    );
  }

  return lines.join("\n");
}
