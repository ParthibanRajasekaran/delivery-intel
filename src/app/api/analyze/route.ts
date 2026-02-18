// ============================================================================
// POST /api/analyze — Main analysis endpoint
// ============================================================================
// Accepts { repo: "owner/repo" } and returns the full RepoAnalysis.
// Uses Redis caching to stay under GitHub API rate limits.
// ============================================================================

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { parseRepoSlug, fetchRecentCommits } from "@/lib/github";
import { computeDORAMetrics } from "@/lib/metrics";
import { scanVulnerabilities } from "@/lib/vulnerabilities";
import { generateSuggestions, computeOverallScore } from "@/lib/suggestions";
import { cacheGet, cacheSet } from "@/lib/cache";
import type { RepoAnalysis } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const repoInput: string | undefined = body?.repo;

    if (!repoInput || typeof repoInput !== "string") {
      return NextResponse.json(
        { error: 'Missing required field: "repo" (e.g., "vercel/next.js").' },
        { status: 400 }
      );
    }

    // Parse the repo identifier
    let id;
    try {
      id = parseRepoSlug(repoInput);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid repository";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // Check cache first
    const cacheKey = `analysis:${id.owner}/${id.repo}`;
    const cached = await cacheGet<RepoAnalysis>(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached, _cached: true });
    }

    // Fetch everything in parallel
    const [recentCommits, doraMetrics, vulnerabilities] = await Promise.all([
      fetchRecentCommits(id, 5),
      computeDORAMetrics(id),
      scanVulnerabilities(id),
    ]);

    // Generate suggestions and score
    const suggestions = generateSuggestions(doraMetrics, vulnerabilities);
    const overallScore = computeOverallScore(doraMetrics, vulnerabilities);

    const analysis: RepoAnalysis = {
      repo: id,
      fetchedAt: new Date().toISOString(),
      recentCommits,
      doraMetrics,
      vulnerabilities,
      suggestions,
      overallScore,
    };

    // Cache for 5 minutes
    await cacheSet(cacheKey, analysis, 300);

    return NextResponse.json(analysis);
  } catch (err: unknown) {
    console.error("[/api/analyze] Error:", err);

    // Detect GitHub rate limit errors
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("rate limit") || message.includes("403")) {
      return NextResponse.json(
        {
          error:
            "GitHub API rate limit exceeded. Please wait a few minutes and try again, or provide a personal access token with higher limits.",
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: `Analysis failed: ${message}` },
      { status: 500 }
    );
  }
}
