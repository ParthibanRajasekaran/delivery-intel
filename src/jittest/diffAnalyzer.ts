// ============================================================================
// JITTest — Diff Analyzer
// ============================================================================
// Parses a unified git diff and extracts structured information about
// which files, functions, and lines changed. This is the foundation of
// code-change-aware test generation, which the Meta JITTest paper
// (arXiv:2601.22832) shows improves catching test effectiveness 4x over
// traditional hardening tests.
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single hunk within a file diff (one @@ block). */
export interface DiffHunk {
  /** Starting line in the OLD file (1-based). */
  oldStart: number;
  /** Number of lines from old file covered by this hunk. */
  oldCount: number;
  /** Starting line in the NEW file (1-based). */
  newStart: number;
  /** Number of lines from the new file covered by this hunk. */
  newCount: number;
  /**
   * Function / method name extracted from the hunk header context
   * (the text after the @@ ... @@ prefix, e.g. "export function normalizeDelta").
   * May be empty if the diff tool produced no context label.
   */
  functionContext: string;
  /** Lines prefixed with '+' (additions), without the leading '+'. */
  addedLines: string[];
  /** Lines prefixed with '-' (removals), without the leading '-'. */
  removedLines: string[];
  /** Context lines (space-prefixed), without the leading ' '. */
  contextLines: string[];
}

/** All change information for a single file. */
export interface ChangedFile {
  /** Repo-relative path (e.g. "src/cli/riskEngine.ts"). */
  path: string;
  /** Old path — differs only for renames. */
  oldPath: string;
  /** Whether the file was created in this diff. */
  isNew: boolean;
  /** Whether the file was deleted in this diff. */
  isDeleted: boolean;
  /** Whether the file was renamed. */
  isRenamed: boolean;
  /** Parsed hunks for this file. */
  hunks: DiffHunk[];
  /** Deduplicated list of function names that have at least one changed line. */
  changedFunctions: string[];
  /** Total added lines across all hunks. */
  totalAdditions: number;
  /** Total removed lines across all hunks. */
  totalDeletions: number;
}

/** Top-level result of analysing a full git diff. */
export interface DiffAnalysis {
  /** Changed / added / deleted files. */
  files: ChangedFile[];
  /** Summary stats across the entire diff. */
  stats: {
    filesChanged: number;
    totalAdditions: number;
    totalDeletions: number;
  };
  /** ISO timestamp the analysis was produced. */
  analyzedAt: string;
}

// ---------------------------------------------------------------------------
// Regex helpers
// ---------------------------------------------------------------------------

// Matches:  diff --git a/some/path b/some/path
const RE_DIFF_HEADER = /^diff --git a\/([^ ]+) b\/(.+)$/;

// Matches:  new file mode 100644  |  deleted file mode 100644  |  rename from/to
const RE_NEW_FILE = /^new file mode/;
const RE_DELETED_FILE = /^deleted file mode/;
const RE_RENAME_FROM = /^rename from (.+)$/m;
const RE_RENAME_TO = /^rename to (.+)$/m;

// Matches:  --- a/path  or  --- /dev/null
const RE_OLD_PATH = /^--- (?:a\/)?(.+)$/;
// Matches:  +++ b/path  or  +++ /dev/null
const RE_NEW_PATH = /^\+\+\+ (?:b\/)?(.+)$/;

// Matches hunk header:
//   @@ -oldStart[,oldCount] +newStart[,newCount] @@ [optional function context]
const RE_HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\s*(.*)$/;

// Extract the function/method name from a hunk context label.
// Handles:
//   "export function normalizeDelta(actual: number, ..."
//   "classifyRiskLevel(score: number)"
//   "  computeRiskScore("
const RE_FUNCTION_NAME =
  /(?:export +(?:default +)?(?:async +)?(?:function +|class +)|(?:async +)?function +|(?:const|let|var) +)(\w+)/;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract the best candidate function name from a hunk context string. */
function extractFunctionName(contextLabel: string): string {
  const trimmed = contextLabel.trim();
  if (!trimmed) {
    return "";
  }

  const match = trimmed.match(RE_FUNCTION_NAME);
  if (match) {
    return match[1];
  }

  // Fallback: take the first identifier-like word
  const fallback = trimmed.match(/^\s*(\w+)/);
  return fallback ? fallback[1] : trimmed.slice(0, 40);
}

/** Build a `ChangedFile` skeleton for a newly encountered file path. */
function makeChangedFile(path: string): ChangedFile {
  return {
    path,
    oldPath: path,
    isNew: false,
    isDeleted: false,
    isRenamed: false,
    hunks: [],
    changedFunctions: [],
    totalAdditions: 0,
    totalDeletions: 0,
  };
}

/** Deduplicate string array while preserving insertion order. */
function dedup(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a unified git diff string and return structured `DiffAnalysis`.
 *
 * Supports multi-file diffs produced by `git diff`, `git diff HEAD`,
 * `git diff --unified=5`, etc.
 *
 * @param rawDiff - The raw text output from a `git diff` command.
 */
export function parseDiff(rawDiff: string): DiffAnalysis {
  const lines = rawDiff.split("\n");
  const files: ChangedFile[] = [];
  let current: ChangedFile | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    // ---- File boundary ----
    const diffHeader = line.match(RE_DIFF_HEADER);
    if (diffHeader) {
      // Close any hunk in progress
      if (currentHunk && current) {
        current.hunks.push(currentHunk);
        currentHunk = null;
      }
      // Close any file in progress
      if (current) {
        finalizeFile(current);
        files.push(current);
      }
      current = makeChangedFile(diffHeader[2]);
      continue;
    }

    if (!current) {
      continue;
    }

    // ---- File-level metadata ----
    if (RE_NEW_FILE.test(line)) {
      current.isNew = true;
      continue;
    }
    if (RE_DELETED_FILE.test(line)) {
      current.isDeleted = true;
      continue;
    }
    const renameFrom = line.match(RE_RENAME_FROM);
    if (renameFrom) {
      current.oldPath = renameFrom[1];
      current.isRenamed = true;
      continue;
    }
    const renameTo = line.match(RE_RENAME_TO);
    if (renameTo) {
      current.path = renameTo[1];
      continue;
    }

    // ---- Path lines (--- / +++) ----
    const oldPathMatch = line.match(RE_OLD_PATH);
    if (oldPathMatch && !currentHunk) {
      if (oldPathMatch[1] !== "/dev/null") {
        current.oldPath = oldPathMatch[1];
      }
      continue;
    }
    const newPathMatch = line.match(RE_NEW_PATH);
    if (newPathMatch && !currentHunk) {
      if (newPathMatch[1] !== "/dev/null") {
        current.path = newPathMatch[1];
      }
      continue;
    }

    // ---- Hunk header ----
    const hunkMatch = line.match(RE_HUNK_HEADER);
    if (hunkMatch) {
      // Commit previous hunk
      if (currentHunk) {
        current.hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: Number.parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] !== undefined ? Number.parseInt(hunkMatch[2], 10) : 1,
        newStart: Number.parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] !== undefined ? Number.parseInt(hunkMatch[4], 10) : 1,
        functionContext: extractFunctionName(hunkMatch[5] ?? ""),
        addedLines: [],
        removedLines: [],
        contextLines: [],
      };
      continue;
    }

    // ---- Hunk body ----
    if (currentHunk) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.addedLines.push(line.slice(1));
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk.removedLines.push(line.slice(1));
      } else if (line.startsWith(" ")) {
        currentHunk.contextLines.push(line.slice(1));
      }
    }
  }

  // Flush last hunk & file
  if (currentHunk && current) {
    current.hunks.push(currentHunk);
  }
  if (current) {
    finalizeFile(current);
    files.push(current);
  }

  const totalAdditions = files.reduce((s, f) => s + f.totalAdditions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.totalDeletions, 0);

  return {
    files,
    stats: {
      filesChanged: files.length,
      totalAdditions,
      totalDeletions,
    },
    analyzedAt: new Date().toISOString(),
  };
}

/** Compute aggregate counts and deduplicate function names after parsing. */
function finalizeFile(file: ChangedFile): void {
  const functionNames: string[] = [];

  for (const hunk of file.hunks) {
    file.totalAdditions += hunk.addedLines.length;
    file.totalDeletions += hunk.removedLines.length;
    if (hunk.functionContext) {
      functionNames.push(hunk.functionContext);
    }
  }

  file.changedFunctions = dedup(functionNames);
}

/**
 * Filter a `DiffAnalysis` to only TypeScript / JavaScript source files,
 * skipping tests, config, and generated files.
 */
export function filterSourceFiles(analysis: DiffAnalysis): ChangedFile[] {
  return analysis.files.filter((f) => {
    if (f.isDeleted) {
      return false;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(f.path)) {
      return false;
    }
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f.path)) {
      return false;
    }
    if (/(^|\/)(__tests__|__mocks__)\//.test(f.path)) {
      return false;
    }
    if (/(^|\/)(node_modules|dist|coverage|\.next)(\/|$)/.test(f.path)) {
      return false;
    }
    return true;
  });
}

/**
 * Collect all unique function names changed across all source files.
 */
export function extractAllChangedFunctions(analysis: DiffAnalysis): string[] {
  return dedup(filterSourceFiles(analysis).flatMap((f) => f.changedFunctions));
}
