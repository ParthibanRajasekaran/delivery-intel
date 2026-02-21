import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadLLMConfig,
  buildUserPrompt,
  generateFallbackNarrative,
  generateNarrativeSummary,
} from "../cli/narrativeSummary";
import type { AnalysisResult } from "../cli/analyzer";
import type { RiskBreakdown } from "../cli/riskEngine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAnalysis(): AnalysisResult {
  return {
    repo: { owner: "acme", repo: "widget" },
    fetchedAt: "2025-01-15T12:00:00Z",
    doraMetrics: {
      deploymentFrequency: {
        deploymentsPerWeek: 14,
        rating: "Elite",
        source: "merged_prs_fallback",
      },
      leadTimeForChanges: { medianHours: 36, rating: "High" },
      changeFailureRate: {
        percentage: 8,
        failedRuns: 8,
        totalRuns: 100,
        rating: "Medium",
      },
    },
    vulnerabilities: [
      {
        packageName: "lodash",
        currentVersion: "4.17.20",
        vulnId: "GHSA-xxxx",
        summary: "Prototype pollution",
        severity: "high",
        aliases: [],
        fixedVersion: "4.17.21",
      },
    ],
    suggestions: [
      {
        category: "security",
        severity: "high",
        title: "Update lodash",
        description: "Fix prototype pollution",
        actionItems: ["npm update lodash"],
      },
    ],
    overallScore: 72,
    dailyDeployments: [2, 3, 1, 4, 2, 5, 3],
  };
}

function makeRisk(): RiskBreakdown {
  return {
    cycleTimeDelta: 0.0172,
    failureRateDelta: 0.0316,
    sentimentMultiplier: 1.0,
    score: 22,
    level: "low",
    summary: "Delivery risk is low (22/100).",
  };
}

// ---------------------------------------------------------------------------
// loadLLMConfig
// ---------------------------------------------------------------------------
describe("loadLLMConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns null when no API key is set", () => {
    delete process.env.DELIVERY_INTEL_LLM_API_KEY;
    expect(loadLLMConfig()).toBeNull();
  });

  it("returns config with defaults when API key is set", () => {
    process.env.DELIVERY_INTEL_LLM_API_KEY = "sk-test-key";
    const config = loadLLMConfig();
    expect(config).not.toBeNull();
    expect(config!.apiKey).toBe("sk-test-key");
    expect(config!.baseUrl).toContain("openai.com");
    expect(config!.model).toBe("gpt-4o-mini");
  });

  it("respects custom base URL and model", () => {
    process.env.DELIVERY_INTEL_LLM_API_KEY = "sk-test";
    process.env.DELIVERY_INTEL_LLM_BASE_URL = "https://custom.api.com/v1";
    process.env.DELIVERY_INTEL_LLM_MODEL = "custom-model";

    const config = loadLLMConfig();
    expect(config!.baseUrl).toBe("https://custom.api.com/v1");
    expect(config!.model).toBe("custom-model");
  });
});

// ---------------------------------------------------------------------------
// buildUserPrompt
// ---------------------------------------------------------------------------
describe("buildUserPrompt", () => {
  const analysis = makeAnalysis();

  it("includes repo name", () => {
    const prompt = buildUserPrompt({ analysis });
    expect(prompt).toContain("acme/widget");
  });

  it("includes DORA metrics JSON", () => {
    const prompt = buildUserPrompt({ analysis });
    expect(prompt).toContain("deploymentFrequency");
    expect(prompt).toContain("leadTimeForChanges");
    expect(prompt).toContain("changeFailureRate");
  });

  it("includes overall score", () => {
    const prompt = buildUserPrompt({ analysis });
    expect(prompt).toContain("72/100");
  });

  it("includes vulnerability summary when present", () => {
    const prompt = buildUserPrompt({ analysis });
    expect(prompt).toContain("Vulnerabilities");
    expect(prompt).toContain("1 dependency vulnerability");
  });

  it("includes suggestions when present", () => {
    const prompt = buildUserPrompt({ analysis });
    expect(prompt).toContain("Update lodash");
  });

  it("includes risk data when provided", () => {
    const prompt = buildUserPrompt({ analysis, risk: makeRisk() });
    expect(prompt).toContain("Burnout Risk Score");
    expect(prompt).toContain("22/100");
  });

  it("excludes risk section when not provided", () => {
    const prompt = buildUserPrompt({ analysis });
    expect(prompt).not.toContain("Burnout Risk Score");
  });

  it("includes daily deployments", () => {
    const prompt = buildUserPrompt({ analysis });
    expect(prompt).toContain("2, 3, 1, 4, 2, 5, 3");
  });
});

// ---------------------------------------------------------------------------
// generateFallbackNarrative
// ---------------------------------------------------------------------------
describe("generateFallbackNarrative", () => {
  it("produces a string narrative", () => {
    const result = generateFallbackNarrative({ analysis: makeAnalysis() });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(50);
  });

  it("includes delivery health verdict", () => {
    const result = generateFallbackNarrative({ analysis: makeAnalysis() });
    expect(result).toContain("AT-RISK");
  });

  it("includes DORA metrics numbers", () => {
    const result = generateFallbackNarrative({ analysis: makeAnalysis() });
    expect(result).toContain("14.0");
    expect(result).toContain("36.0");
    expect(result).toContain("8.0%");
  });

  it("includes vulnerability count when present", () => {
    const result = generateFallbackNarrative({ analysis: makeAnalysis() });
    expect(result).toContain("1 dependency vulnerabilit");
  });

  it("includes risk score when provided", () => {
    const result = generateFallbackNarrative({
      analysis: makeAnalysis(),
      risk: makeRisk(),
    });
    expect(result).toContain("22/100");
    expect(result).toContain("low");
  });

  it("classifies healthy repos correctly", () => {
    const analysis = makeAnalysis();
    analysis.overallScore = 90;
    const result = generateFallbackNarrative({ analysis });
    expect(result).toContain("HEALTHY");
  });

  it("classifies at-risk repos correctly", () => {
    const analysis = makeAnalysis();
    analysis.overallScore = 55;
    const result = generateFallbackNarrative({ analysis });
    expect(result).toContain("AT-RISK");
  });

  it("classifies severely degraded repos correctly", () => {
    const analysis = makeAnalysis();
    analysis.overallScore = 20;
    const result = generateFallbackNarrative({ analysis });
    expect(result).toContain("DEGRADED");
  });

  it("includes top suggestion", () => {
    const result = generateFallbackNarrative({ analysis: makeAnalysis() });
    expect(result).toContain("Update lodash");
  });
});

// ---------------------------------------------------------------------------
// generateNarrativeSummary (with mocked fetch)
// ---------------------------------------------------------------------------

function mockLLMResponse(content: string, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      model: "gpt-4o-mini",
      ...overrides,
    }),
  };
}

describe("generateNarrativeSummary", () => {
  const mockConfig = {
    apiKey: "sk-test",
    baseUrl: "https://api.example.com/v1",
    model: "gpt-4o-mini",
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no config is available", async () => {
    const result = await generateNarrativeSummary({ analysis: makeAnalysis() });
    // No env var set and no override → null
    expect(result).toBeNull();
  });

  it("parses a successful LLM response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          mockLLMResponse("This is the executive summary.", { usage: { total_tokens: 150 } }),
        ),
    );

    const result = await generateNarrativeSummary({ analysis: makeAnalysis() }, mockConfig);

    expect(result).not.toBeNull();
    expect(result!.narrative).toBe("This is the executive summary.");
    expect(result!.model).toBe("gpt-4o-mini");
    expect(result!.tokensUsed).toBe(150);
  });

  it("throws on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "Unauthorized" }),
    );

    await expect(
      generateNarrativeSummary({ analysis: makeAnalysis() }, mockConfig),
    ).rejects.toThrow("LLM API error 401: Unauthorized");
  });

  it("throws on empty LLM response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockLLMResponse("")));

    await expect(
      generateNarrativeSummary({ analysis: makeAnalysis() }, mockConfig),
    ).rejects.toThrow("LLM returned an empty response");
  });

  it("sends correct headers and body to the LLM API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockLLMResponse("Summary text."));
    vi.stubGlobal("fetch", fetchMock);

    await generateNarrativeSummary({ analysis: makeAnalysis() }, mockConfig);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
  });

  it("handles AbortError from timeout", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(
      generateNarrativeSummary({ analysis: makeAnalysis() }, mockConfig),
    ).rejects.toThrow("timed out");
  });
});
