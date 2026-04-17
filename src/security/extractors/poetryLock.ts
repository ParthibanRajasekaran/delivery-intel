import type { DependencyExtractor } from "./index.js";
import type { ParsedDependency } from "../../shared/parsers.js";

/** Minimal poetry.lock parser — extracts [[package]] entries. */
function parsePoetryLock(raw: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const blocks = raw.split(/\[\[package\]\]/g).slice(1);
  for (const block of blocks) {
    const nameMatch = /name\s*=\s*"([^"]+)"/.exec(block);
    const versionMatch = /version\s*=\s*"([^"]+)"/.exec(block);
    if (nameMatch && versionMatch) {
      deps.push({ name: nameMatch[1], version: versionMatch[1], ecosystem: "PyPI" });
    }
  }
  return deps;
}

export const poetryLockExtractor: DependencyExtractor = {
  id: "pypi-poetry-lock",
  name: "PyPI (poetry.lock)",
  detect(paths) {
    for (const p of paths) {
      if (p === "poetry.lock") {
        return true;
      }
    }
    return false;
  },
  extract(files) {
    const content = files.get("poetry.lock");
    return content ? parsePoetryLock(content) : [];
  },
};
