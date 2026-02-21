// ============================================================================
// Shared vulnerability scanning logic (no Next.js / @/ alias dependencies)
// ============================================================================

import type { ParsedDependency } from "./parsers.js";
import { queryOSV, classifySeverity, extractFixedVersion } from "./osv.js";

export interface VulnerabilityResult {
  packageName: string;
  currentVersion: string;
  vulnId: string;
  summary: string;
  severity: string;
  aliases: string[];
  fixedVersion: string | null;
}

/**
 * Query OSV.dev for a list of parsed dependencies and return vulnerabilities.
 * Batches requests in groups of `batchSize` to avoid overwhelming the API.
 */
export async function scanDependencies(
  deps: ParsedDependency[],
  batchSize = 10,
): Promise<VulnerabilityResult[]> {
  if (deps.length === 0) {
    return [];
  }

  const vulnerabilities: VulnerabilityResult[] = [];

  for (let i = 0; i < deps.length; i += batchSize) {
    const batch = deps.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((dep) => queryOSV(dep.ecosystem, dep.name, dep.version)),
    );

    for (let j = 0; j < batch.length; j++) {
      const dep = batch[j];
      for (const vuln of results[j]) {
        vulnerabilities.push({
          packageName: dep.name,
          currentVersion: dep.version,
          vulnId: vuln.id,
          summary: vuln.summary || "No description available.",
          severity: classifySeverity(vuln.severity),
          aliases: vuln.aliases || [],
          fixedVersion: extractFixedVersion(vuln.affected, dep),
        });
      }
    }
  }

  return vulnerabilities;
}
