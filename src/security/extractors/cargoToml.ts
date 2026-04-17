import type { DependencyExtractor } from "./index.js";
import type { ParsedDependency } from "../../shared/parsers.js";

/** Parse Cargo.toml [dependencies] and [dev-dependencies] sections. */
function parseCargoToml(raw: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const lines = raw.split("\n");
  let inDepSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Section header
    if (trimmed.startsWith("[") && trimmed.includes("]")) {
      const header = trimmed.slice(1, trimmed.indexOf("]"));
      inDepSection = header === "dependencies" || header === "dev-dependencies";
      continue;
    }

    if (!inDepSection || !trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }

    const name = trimmed.slice(0, eqIdx).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      continue;
    }

    const valuePart = trimmed.slice(eqIdx + 1).trim();

    // Simple string: name = "1.0.0"
    if (valuePart.startsWith('"')) {
      const end = valuePart.indexOf('"', 1);
      if (end > 1) {
        deps.push({ name, version: valuePart.slice(1, end), ecosystem: "crates.io" });
      }
      continue;
    }

    // Inline table: name = { version = "1.0.0", ... }
    const vIdx = valuePart.indexOf("version");
    if (vIdx !== -1) {
      const eqI = valuePart.indexOf("=", vIdx + 7);
      if (eqI !== -1) {
        const rest = valuePart.slice(eqI + 1).trim();
        if (rest.startsWith('"')) {
          const end = rest.indexOf('"', 1);
          if (end > 1) {
            deps.push({ name, version: rest.slice(1, end), ecosystem: "crates.io" });
          }
        }
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
