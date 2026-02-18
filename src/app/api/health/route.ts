// ============================================================================
// GET /api/health — Simple healthcheck
// ============================================================================

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: {
      hasGithubToken: !!process.env.GITHUB_TOKEN,
      hasRedis: !!process.env.REDIS_URL,
    },
  });
}
