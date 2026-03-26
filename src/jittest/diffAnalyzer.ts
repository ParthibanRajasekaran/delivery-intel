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
const RE_HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[ \t]*([^\n]{0,300})$/;

// Extract the function/method name from a hunk context label.
// Handles:
//   "export function normalizeDelta(actual: number, ..."
//   "classifyRiskLevel(score: number)"
//   "  computeRiskScore("
const RE_FUNC_KEYWORD = /\bfunction[ \t]+(\w+)/;
const RE_CLASS_KEYWORD = /\bclass[ \t]+(\w+)/;
const RE_DECL_KEYWORD = /\b(?:const|let|var)[ \t]+(\w+)/;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract the best candidate function name from a hunk context string. */
function extractFunctionName(contextLabel: string): string {
  const trimmed = contextLabel.trim();
  if (!trimmed) {
    return "";
  }

  const fnMatch = RE_FUNC_KEYWORD.exec(trimmed);
  if (fnMatch) {
    return fnMatch[1];
  }
  const clsMatch = RE_CLASS_KEYWORD.exec(trimmed);
  if (clsMatch) {
    return clsMatch[1];
  }
  const declMatch = RE_DECL_KEYWORD.exec(trimmed);
  if (declMatch) {
    return declMatch[1];
  }

  // Fallback: take the first identifier-like word
  const fallback = /^\s*(\w+)/.exec(trimmed);
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
// Parser helpers (extracted to reduce cognitive complexity of parseDiff)
// ---------------------------------------------------------------------------

interface ParseState {
  current: ChangedFile | null;
  currentHunk: DiffHunk | null;
  files: ChangedFile[];
}

/** Flush the current hunk into the current file's hunk list. */
function flushHunk(state: ParseState): void {
  if (state.currentHunk && state.current) {
    state.current.hunks.push(state.currentHunk);
    state.currentHunk = null;
  }
}

/** Finalize and flush the current file into the file list. */
function flushFile(state: ParseState): void {
  if (state.current) {
    finalizeFile(state.current);
    state.files.push(state.current);
    state.current = null;
  }
}

/** Apply file-level metadata lines (new/deleted/rename). Returns true if handled. */
function handleFileMetadata(line: string, current: ChangedFile): boolean {
  if (RE_NEW_FILE.test(line)) {
    current.isNew = true;
    return true;
  }
  if (RE_DELETED_FILE.test(line)) {
    current.isDeleted = true;
    return true;
  }
  const renameFrom = RE_RENAME_FROM.exec(line);
  if (renameFrom) {
    current.oldPath = renameFrom[1];
    current.isRenamed = true;
    return true;
  }
  const renameTo = RE_RENAME_TO.exec(line);
  if (renameTo) {
    current.path = renameTo[1];
    return true;
  }
  return false;
}

/** Handle --- / +++ path lines (only outside a hunk). Returns true if handled. */
function handlePathLine(line: string, current: ChangedFile, inHunk: boolean): boolean {
  if (inHunk) {
    return false;
  }
  const oldPathMatch = RE_OLD_PATH.exec(line);
  if (oldPathMatch) {
    if (oldPathMatch[1] !== "/dev/null") {
      current.oldPath = oldPathMatch[1];
    }
    return true;
  }
  const newPathMatch = RE_NEW_PATH.exec(line);
  if (newPathMatch) {
    if (newPathMatch[1] !== "/dev/null") {
      current.path = newPathMatch[1];
    }
    return true;
  }
  return false;
}

/** Build a DiffHunk from a hunk header regex match. */
function createHunkFromMatch(m: RegExpExecArray): DiffHunk {
  return {
    oldStart: Number.parseInt(m[1], 10),
    oldCount: m[2] === undefined ? 1 : Number.parseInt(m[2], 10),
    newStart: Number.parseInt(m[3], 10),
    newCount: m[4] === undefined ? 1 : Number.parseInt(m[4], 10),
    functionContext: extractFunctionName(m[5] ?? ""),
    addedLines: [],
    removedLines: [],
    contextLines: [],
  };
}

/** Categorise a single line within a hunk body. */
function processHunkLine(line: string, hunk: DiffHunk): void {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    hunk.addedLines.push(line.slice(1));
  } else if (line.startsWith("-") && !line.startsWith("---")) {
    hunk.removedLines.push(line.slice(1));
  } else if (line.startsWith(" ")) {
    hunk.contextLines.push(line.slice(1));
  }
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
  const state: ParseState = { current: null, currentHunk: null, files: [] };

  for (const line of lines) {
    const diffHeader = RE_DIFF_HEADER.exec(line);
    if (diffHeader) {
      flushHunk(state);
      flushFile(state);
      state.current = makeChangedFile(diffHeader[2]);
      continue;
    }

    if (!state.current) {
      continue;
    }

    if (handleFileMetadata(line, state.current)) {
      continue;
    }
    if (handlePathLine(line, state.current, state.currentHunk !== null)) {
      continue;
    }

    const hunkMatch = RE_HUNK_HEADER.exec(line);
    if (hunkMatch) {
      if (state.currentHunk) {
        state.current.hunks.push(state.currentHunk);
      }
      state.currentHunk = createHunkFromMatch(hunkMatch);
      continue;
    }

    if (state.currentHunk) {
      processHunkLine(line, state.currentHunk);
    }
  }

  // Flush last hunk & file
  flushHunk(state);
  flushFile(state);

  const totalAdditions = state.files.reduce((s, f) => s + f.totalAdditions, 0);
  const totalDeletions = state.files.reduce((s, f) => s + f.totalDeletions, 0);

  return {
    files: state.files,
    stats: {
      filesChanged: state.files.length,
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
