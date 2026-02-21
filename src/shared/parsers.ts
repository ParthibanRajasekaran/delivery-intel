// ============================================================================
// Shared Dependency-Manifest Parsers
// ============================================================================
// Reusable across the Next.js app (`src/lib/vulnerabilities.ts`) and the
// standalone CLI (`src/cli/analyzer.ts`) so the parsing logic lives in one
// place.
// ============================================================================

export interface ParsedDependency {
  name: string;
  version: string;
  ecosystem: string;
}

// ---------------------------------------------------------------------------
// package.json (npm)
// ---------------------------------------------------------------------------

export function parsePackageJson(raw: string): ParsedDependency[] {
  try {
    const pkg = JSON.parse(raw);
    const deps: ParsedDependency[] = [];
    for (const section of ["dependencies", "devDependencies"] as const) {
      const map = pkg[section] as Record<string, string> | undefined;
      if (!map) {
        continue;
      }
      for (const [name, spec] of Object.entries(map)) {
        deps.push({ name, version: spec.replace(/^[\^~>=<]+/, ""), ecosystem: "npm" });
      }
    }
    return deps;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// requirements.txt (PyPI)
// ---------------------------------------------------------------------------

export function parseRequirementsTxt(raw: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*[=><~!]+\s*([0-9.]+)/);
    if (match) {
      deps.push({ name: match[1], version: match[2], ecosystem: "PyPI" });
    }
  }
  return deps;
}

// ---------------------------------------------------------------------------
// go.mod (Go)
// ---------------------------------------------------------------------------

export function parseGoMod(raw: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const requireBlock = raw.match(/require\s*\(([\s\S]*?)\)/);
  if (!requireBlock) {
    return deps;
  }
  for (const line of requireBlock[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      deps.push({ name: parts[0], version: parts[1].replace(/^v/, ""), ecosystem: "Go" });
    }
  }
  return deps;
}
