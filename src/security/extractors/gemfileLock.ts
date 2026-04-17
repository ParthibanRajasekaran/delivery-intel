import type { DependencyExtractor } from "./index.js";
import type { ParsedDependency } from "../../shared/parsers.js";

/** Parse Gemfile.lock GEM section. */
function parseGemfileLock(raw: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const inGem = /GEM[\s\S]*?specs:([\s\S]*?)(?=\n[A-Z]|$)/.exec(raw);
  if (!inGem) {
    return deps;
  }
  const re = /^\s{4}([a-zA-Z0-9_-]+)\s+\(([^)]+)\)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inGem[1])) !== null) {
    deps.push({ name: m[1], version: m[2], ecosystem: "RubyGems" });
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
