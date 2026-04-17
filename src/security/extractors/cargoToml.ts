import type { DependencyExtractor } from "./index.js";
import type { ParsedDependency } from "../../shared/parsers.js";

/** Parse Cargo.toml [dependencies] and [dev-dependencies] sections. */
function parseCargoToml(raw: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const inDeps = /\[(dev-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g;
  let section: RegExpExecArray | null;
  while ((section = inDeps.exec(raw)) !== null) {
    const block = section[2];
    // Simple "name = version" or 'name = { version = "..." }'
    const lineRe = /^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|.*?version\s*=\s*"([^"]+)")/gm;
    let m: RegExpExecArray | null;
    while ((m = lineRe.exec(block)) !== null) {
      const version = m[2] ?? m[3];
      if (version) {
        deps.push({ name: m[1], version, ecosystem: "crates.io" });
      }
    }
  }
  return deps;
}

export const cargoTomlExtractor: DependencyExtractor = {
  id: "cargo-toml",
  name: "Rust (Cargo.toml)",
  detect(paths) {
    for (const p of paths) {
      if (p === "Cargo.toml") {
        return true;
      }
    }
    return false;
  },
  extract(files) {
    const content = files.get("Cargo.toml");
    return content ? parseCargoToml(content) : [];
  },
};
