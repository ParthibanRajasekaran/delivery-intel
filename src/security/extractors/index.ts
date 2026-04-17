// ============================================================================
// Security: Dependency Extractor Interface
// ============================================================================
// Pluggable extractor system — each extractor knows which manifest files it
// handles, how to detect their presence, and how to parse them.
// New ecosystems are added by implementing this interface and registering
// the extractor in the registry below.
// ============================================================================

import type { ParsedDependency } from "../../shared/parsers.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface DependencyExtractor {
  /** Stable machine-readable identifier (e.g. "npm-package-json"). */
  id: string;
  /** Human-readable name for caveats/source attribution. */
  name: string;
  /** Returns true if any of the provided manifest file paths are handled by this extractor. */
  detect(paths: Iterable<string>): boolean;
  /**
   * Extract dependencies from a map of path → content.
   * Only files relevant to this extractor will be in the map.
   */
  extract(files: Map<string, string>): ParsedDependency[];
}

// ---------------------------------------------------------------------------
// Built-in extractors
// ---------------------------------------------------------------------------

import { packageJsonExtractor } from "./packageJson.js";
import { requirementsTxtExtractor } from "./requirementsTxt.js";
import { goModExtractor } from "./goMod.js";
import { poetryLockExtractor } from "./poetryLock.js";
import { pnpmLockExtractor } from "./pnpmLock.js";
import { cargoTomlExtractor } from "./cargoToml.js";
import { gemfileLockExtractor } from "./gemfileLock.js";

export const EXTRACTORS: readonly DependencyExtractor[] = [
  packageJsonExtractor,
  requirementsTxtExtractor,
  goModExtractor,
  poetryLockExtractor,
  pnpmLockExtractor,
  cargoTomlExtractor,
  gemfileLockExtractor,
];

// ---------------------------------------------------------------------------
// Run all extractors against a manifest file map
// ---------------------------------------------------------------------------

export interface ExtractorResult {
  deps: ParsedDependency[];
  /** Which extractors contributed. */
  sources: string[];
}

export function extractAllDependencies(files: Map<string, string>): ExtractorResult {
  const deps: ParsedDependency[] = [];
  const sources: string[] = [];
  for (const extractor of EXTRACTORS) {
    if (extractor.detect(files.keys())) {
      const extracted = extractor.extract(files);
      if (extracted.length > 0) {
        deps.push(...extracted);
        sources.push(extractor.name);
      }
    }
  }
  return { deps, sources };
}
