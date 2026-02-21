// ============================================================================
// OSV.dev Vulnerability Scanner
// ============================================================================
// Instead of relying on Dependabot (which requires admin permissions), we
// parse dependency manifests and query the free OSV.dev API.
// ============================================================================

import type { RepoIdentifier, DependencyVulnerability } from "@/types";
import { fetchFileContent } from "./github";
import {
  type ParsedDependency,
  parsePackageJson,
  parseRequirementsTxt,
  parseGoMod,
} from "@/shared/parsers";
import { queryOSV, classifySeverity, extractFixedVersion } from "@/shared/osv";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan a repository for dependency vulnerabilities.
 * 1. Fetches package.json / requirements.txt / go.mod
 * 2. Parses dependencies
 * 3. Queries OSV.dev for each dependency
 *
 * Returns a flat list of vulnerabilities found.
 */
export async function scanVulnerabilities(id: RepoIdentifier): Promise<DependencyVulnerability[]> {
  // Fetch known manifest files in parallel
  const [pkgJson, reqTxt, goMod] = await Promise.all([
    fetchFileContent(id, "package.json"),
    fetchFileContent(id, "requirements.txt"),
    fetchFileContent(id, "go.mod"),
  ]);

  const allDeps: ParsedDependency[] = [];
  if (pkgJson) {
    allDeps.push(...parsePackageJson(pkgJson));
  }
  if (reqTxt) {
    allDeps.push(...parseRequirementsTxt(reqTxt));
  }
  if (goMod) {
    allDeps.push(...parseGoMod(goMod));
  }

  if (allDeps.length === 0) {
    return [];
  }

  // Query OSV.dev — batch in groups of 10 to avoid overwhelming the API
  const vulnerabilities: DependencyVulnerability[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < allDeps.length; i += BATCH_SIZE) {
    const batch = allDeps.slice(i, i + BATCH_SIZE);
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
