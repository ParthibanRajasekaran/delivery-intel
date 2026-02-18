// ============================================================================
// OSV.dev Vulnerability Scanner
// ============================================================================
// Instead of relying on Dependabot (which requires admin permissions), we
// parse dependency manifests and query the free OSV.dev API.
// ============================================================================

import type { RepoIdentifier, DependencyVulnerability } from "@/types";
import { fetchFileContent } from "./github";

// ---------------------------------------------------------------------------
// Manifest parsing
// ---------------------------------------------------------------------------

interface ParsedDependency {
  name: string;
  version: string;
  ecosystem: string;
}

function parsePackageJson(raw: string): ParsedDependency[] {
  try {
    const pkg = JSON.parse(raw);
    const deps: ParsedDependency[] = [];
    for (const section of ["dependencies", "devDependencies"] as const) {
      const map = pkg[section] as Record<string, string> | undefined;
      if (!map) continue;
      for (const [name, versionSpec] of Object.entries(map)) {
        // Strip ^, ~, >=, etc. to get a bare version
        const version = versionSpec.replace(/^[\^~>=<]+/, "");
        deps.push({ name, version, ecosystem: "npm" });
      }
    }
    return deps;
  } catch {
    return [];
  }
}

function parseRequirementsTxt(raw: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // e.g., flask==2.3.0 or requests>=2.28.0
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*[=><~!]+\s*([0-9.]+)/);
    if (match) {
      deps.push({
        name: match[1],
        version: match[2],
        ecosystem: "PyPI",
      });
    }
  }
  return deps;
}

function parseGoMod(raw: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const requireBlock = raw.match(/require\s*\(([\s\S]*?)\)/);
  if (!requireBlock) return deps;
  for (const line of requireBlock[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      deps.push({
        name: parts[0],
        version: parts[1].replace(/^v/, ""),
        ecosystem: "Go",
      });
    }
  }
  return deps;
}

// ---------------------------------------------------------------------------
// OSV.dev API
// ---------------------------------------------------------------------------

interface OSVQueryResult {
  vulns?: Array<{
    id: string;
    summary?: string;
    aliases?: string[];
    severity?: Array<{ type: string; score: string }>;
    affected?: Array<{
      package: { name: string; ecosystem: string };
      ranges?: Array<{
        type: string;
        events: Array<{ introduced?: string; fixed?: string }>;
      }>;
    }>;
  }>;
}

async function queryOSV(
  ecosystem: string,
  packageName: string,
  version: string
): Promise<OSVQueryResult> {
  try {
    const res = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version,
        package: { name: packageName, ecosystem },
      }),
    });
    if (!res.ok) return { vulns: [] };
    return (await res.json()) as OSVQueryResult;
  } catch {
    return { vulns: [] };
  }
}

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
export async function scanVulnerabilities(
  id: RepoIdentifier
): Promise<DependencyVulnerability[]> {
  // Fetch known manifest files in parallel
  const [pkgJson, reqTxt, goMod] = await Promise.all([
    fetchFileContent(id, "package.json"),
    fetchFileContent(id, "requirements.txt"),
    fetchFileContent(id, "go.mod"),
  ]);

  const allDeps: ParsedDependency[] = [];
  if (pkgJson) allDeps.push(...parsePackageJson(pkgJson));
  if (reqTxt) allDeps.push(...parseRequirementsTxt(reqTxt));
  if (goMod) allDeps.push(...parseGoMod(goMod));

  if (allDeps.length === 0) return [];

  // Query OSV.dev — batch in groups of 10 to avoid overwhelming the API
  const vulnerabilities: DependencyVulnerability[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < allDeps.length; i += BATCH_SIZE) {
    const batch = allDeps.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((dep) => queryOSV(dep.ecosystem, dep.name, dep.version))
    );

    for (let j = 0; j < batch.length; j++) {
      const dep = batch[j];
      const vulns = results[j].vulns || [];
      for (const vuln of vulns) {
        // Determine the fixed version if available
        let fixedVersion: string | null = null;
        const affected = vuln.affected?.find(
          (a) =>
            a.package.name === dep.name &&
            a.package.ecosystem === dep.ecosystem
        );
        if (affected?.ranges) {
          for (const range of affected.ranges) {
            for (const event of range.events) {
              if (event.fixed) {
                fixedVersion = event.fixed;
                break;
              }
            }
          }
        }

        // Determine severity
        let severity = "unknown";
        if (vuln.severity && vuln.severity.length > 0) {
          const cvss = parseFloat(vuln.severity[0].score);
          if (cvss >= 9) severity = "critical";
          else if (cvss >= 7) severity = "high";
          else if (cvss >= 4) severity = "medium";
          else severity = "low";
        }

        vulnerabilities.push({
          packageName: dep.name,
          currentVersion: dep.version,
          vulnId: vuln.id,
          summary: vuln.summary || "No description available.",
          severity,
          aliases: vuln.aliases || [],
          fixedVersion,
        });
      }
    }
  }

  return vulnerabilities;
}
