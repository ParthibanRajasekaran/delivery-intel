import type { DependencyExtractor } from "./index.js";
import type { ParsedDependency } from "../../shared/parsers.js";

/** Parse pnpm-lock.yaml for package names and resolved versions. */
function parsePnpmLock(raw: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  // pnpm-lock.yaml v6+: packages section has entries like:
  //   /lodash@4.17.21:
  //     resolution: ...
  const re = /^\s{2}\/?((?:@[^/@]+\/)?[^/@\s]+)@([^\s:]+):/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    deps.push({ name: m[1], version: m[2], ecosystem: "npm" });
  }
  return deps;
}

export const pnpmLockExtractor: DependencyExtractor = {
  id: "npm-pnpm-lock",
  name: "npm (pnpm-lock.yaml)",
  detect(paths) {
    for (const p of paths) {
      if (p === "pnpm-lock.yaml") {
        return true;
      }
    }
    return false;
  },
  extract(files) {
    const content = files.get("pnpm-lock.yaml");
    return content ? parsePnpmLock(content) : [];
  },
};
