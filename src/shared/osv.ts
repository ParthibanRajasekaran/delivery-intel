// ============================================================================
// Shared OSV.dev Helpers
// ============================================================================
// Common vulnerability-query and classification logic used by both the
// Next.js lib (`src/lib/vulnerabilities.ts`) and the standalone CLI
// (`src/cli/analyzer.ts`).
// ============================================================================

import type { ParsedDependency } from "./parsers";

// ---------------------------------------------------------------------------
// OSV response types
// ---------------------------------------------------------------------------

export interface OsvVulnSeverity {
  type: string;
  score: string;
}

export interface OsvVulnAffected {
  package: { name: string; ecosystem: string };
  ranges?: Array<{
    type: string;
    events: Array<{ introduced?: string; fixed?: string }>;
  }>;
}

export interface OsvVuln {
  id: string;
  summary?: string;
  aliases?: string[];
  severity?: OsvVulnSeverity[];
  affected?: OsvVulnAffected[];
}

// ---------------------------------------------------------------------------
// Query the OSV.dev API for a single package+version
// ---------------------------------------------------------------------------

export async function queryOSV(
  ecosystem: string,
  packageName: string,
  version: string,
): Promise<OsvVuln[]> {
  try {
    const res = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, package: { name: packageName, ecosystem } }),
    });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { vulns?: OsvVuln[] };
    return data.vulns ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Classify CVSS severity into a human-readable label
// ---------------------------------------------------------------------------

export function classifySeverity(severity?: OsvVulnSeverity[]): string {
  if (!severity || severity.length === 0) {
    return "unknown";
  }
  const cvss = parseFloat(severity[0].score);
  if (cvss >= 9) {
    return "critical";
  }
  if (cvss >= 7) {
    return "high";
  }
  if (cvss >= 4) {
    return "medium";
  }
  return "low";
}

// ---------------------------------------------------------------------------
// Extract the earliest "fixed" version from an OSV affected entry
// ---------------------------------------------------------------------------

export function extractFixedVersion(
  affected: OsvVulnAffected[] | undefined,
  dep: Pick<ParsedDependency, "name" | "ecosystem">,
): string | null {
  const entry = affected?.find(
    (a) => a.package.name === dep.name && a.package.ecosystem === dep.ecosystem,
  );
  if (!entry?.ranges) {
    return null;
  }
  for (const range of entry.ranges) {
    for (const event of range.events) {
      if (event.fixed) {
        return event.fixed;
      }
    }
  }
  return null;
}
