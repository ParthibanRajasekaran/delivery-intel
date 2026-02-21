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
import { scanDependencies } from "@/shared/scanner";

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

  return scanDependencies(allDeps);
}
