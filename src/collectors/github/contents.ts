// ============================================================================
// Collector: GitHub Repository File Contents
// ============================================================================
// Fetches manifest files (package.json, requirements.txt, go.mod, etc.)
// needed for dependency / vulnerability scanning.
// ============================================================================

import type { Octokit } from "@octokit/rest";
import type { RepoIdentifier } from "../../shared/github.js";

const MANIFEST_PATHS = [
  "package.json",
  "requirements.txt",
  "go.mod",
  "Pipfile.lock",
  "poetry.lock",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "Cargo.toml",
  "pom.xml",
  "Gemfile.lock",
];

async function fetchOneFile(
  octokit: Octokit,
  id: RepoIdentifier,
  path: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: id.owner,
      repo: id.repo,
      path,
    });
    if ("content" in data && typeof data.content === "string") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Collect all known manifest files in parallel.
 * Returns a Map of path → content for every file that was readable.
 */
export async function collectManifestFiles(
  octokit: Octokit,
  id: RepoIdentifier,
  extraPaths: string[] = [],
): Promise<Map<string, string>> {
  const paths = [...new Set([...MANIFEST_PATHS, ...extraPaths])];
  const results = await Promise.all(paths.map((p) => fetchOneFile(octokit, id, p)));
  const map = new Map<string, string>();
  paths.forEach((p, i) => {
    const content = results[i];
    if (content !== null) {
      map.set(p, content);
    }
  });
  return map;
}
