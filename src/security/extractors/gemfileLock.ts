import type { DependencyExtractor } from "./index.js";
import type { ParsedDependency } from "../../shared/parsers.js";

/** Parse Gemfile.lock GEM section. */
function parseGemfileLock(raw: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const lines = raw.split("\n");
  let inGemSection = false;
  let inSpecsSection = false;

  for (const line of lines) {
    // Top-level section marker
    if (line === "GEM") {
      inGemSection = true;
      continue;
    }

    // A new non-indented, non-empty line that isn't "GEM" ends the section
    if (inGemSection && line.length > 0 && line[0] !== " " && line !== "GEM") {
      inGemSection = false;
      inSpecsSection = false;
      continue;
    }

    if (inGemSection && line.trim() === "specs:") {
      inSpecsSection = true;
      continue;
    }

    if (!inSpecsSection) {
      continue;
    }

    // Direct gem entries are indented exactly 4 spaces: "    name (version)"
    const m = /^ {4}([a-zA-Z0-9_-]+) \(([^)]+)\)/.exec(line);
    if (m) {
      deps.push({ name: m[1], version: m[2], ecosystem: "RubyGems" });
    }
  }

  return deps;
}

export const gemfileLockExtractor: DependencyExtractor = {
  id: "rubygems-gemfile-lock",
  name: "RubyGems (Gemfile.lock)",
  detect(paths) {
    for (const p of paths) {
      if (p === "Gemfile.lock") {
        return true;
      }
    }
    return false;
  },
  extract(files) {
    const content = files.get("Gemfile.lock");
    return content ? parseGemfileLock(content) : [];
  },
};
