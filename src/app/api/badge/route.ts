// ============================================================================
// GET /api/badge?repo=owner/repo  — Shields.io endpoint badge
// ============================================================================
// Returns a Shields.io-compatible JSON payload so any project can embed a
// live delivery score badge in their README with a single URL.
//
// Shields endpoint schema: https://shields.io/badges/endpoint-badge
// ============================================================================

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { parseRepoSlug } from "@/lib/github";
import { computeDORAMetrics } from "@/lib/metrics";
import { scanVulnerabilities } from "@/lib/vulnerabilities";
import { computeOverallScore } from "@/lib/suggestions";
import { cacheGet, cacheSet } from "@/lib/cache";

// Cache badge results for 5 minutes server-side; CDN may cache up to 10 min.
const CACHE_TTL_SECONDS = 300;

function scoreToColor(score: number): string {
  if (score >= 80) {
    return "brightgreen";
  }
  if (score >= 60) {
    return "green";
  }
  if (score >= 40) {
    return "yellow";
  }
  if (score >= 20) {
    return "orange";
  }
  return "red";
}

function errorBadge(message: string) {
  return NextResponse.json({
    schemaVersion: 1,
    label: "delivery score",
    message,
    color: "lightgrey",
    isError: true,
  });
}

export async function GET(request: NextRequest) {
  const repoInput = request.nextUrl.searchParams.get("repo");

  if (!repoInput) {
    return errorBadge("missing repo");
  }

  let id;
  try {
    id = parseRepoSlug(repoInput);
  } catch {
    return errorBadge("invalid repo");
  }

  const cacheKey = `badge:${id.owner}/${id.repo}`;
  const cached = await cacheGet<{ score: number }>(cacheKey);
  if (cached) {
    return NextResponse.json(
      {
        schemaVersion: 1,
        label: "delivery score",
        message: `${cached.score}/100`,
        color: scoreToColor(cached.score),
        isError: false,
      },
      { headers: { "Cache-Control": `s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=600` } },
    );
  }

  try {
    const [doraMetrics, vulnerabilities] = await Promise.all([
      computeDORAMetrics(id),
      scanVulnerabilities(id),
    ]);
    const score = computeOverallScore(doraMetrics, vulnerabilities);

    await cacheSet(cacheKey, { score }, CACHE_TTL_SECONDS);

    return NextResponse.json(
      {
        schemaVersion: 1,
        label: "delivery score",
        message: `${score}/100`,
        color: scoreToColor(score),
        isError: false,
      },
      { headers: { "Cache-Control": `s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=600` } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "error";
    const isRateLimit = message.includes("rate limit") || message.includes("403");
    return errorBadge(isRateLimit ? "rate limited" : "error");
  }
}
