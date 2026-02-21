import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// CLI smoke tests — verifies: help output, version flag, missing-repo error
//
// These tests spawn the CLI as a subprocess so they exercise the real entry
// point (bin/delivery-intel.js → dist/cli/index.js) without needing network
// access (they never reach the GitHub API).
//
// The CLI bin requires the built dist/ artefact. When it is absent (e.g. in a
// CI unit-test step that runs before `build:cli`), the suite is skipped.
//
// Uses execFileSync (no shell) to avoid command-injection hotspots.
// ---------------------------------------------------------------------------

const BIN = path.resolve(__dirname, "../../bin/delivery-intel.js");
const DIST_ENTRY = path.resolve(__dirname, "../../dist/cli/index.js");
const CLI_BUILT = fs.existsSync(DIST_ENTRY);

function run(args: string[]): { stdout: string; code: number } {
  try {
    const stdout = execFileSync("node", [BIN, ...args], {
      encoding: "utf-8",
      timeout: 15_000,
      env: { ...process.env, NODE_ENV: "test" },
    });
    return { stdout, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}

describe.skipIf(!CLI_BUILT)("CLI smoke tests", () => {
  it("prints help text when invoked with --help", () => {
    const { stdout, code } = run(["--help"]);

    expect(code).toBe(0);
    expect(stdout).toContain("delivery-intel");
    expect(stdout).toContain("USAGE");
    expect(stdout).toContain("OPTIONS");
  });

  it("prints help text when invoked with no arguments", () => {
    const { stdout, code } = run([]);

    expect(code).toBe(0);
    expect(stdout).toContain("delivery-intel");
    expect(stdout).toContain("USAGE");
  });

  it("prints version when invoked with --version", () => {
    const { stdout, code } = run(["--version"]);

    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exits with error when repo has no token available", () => {
    // Run without any GitHub token to test auth-failure path
    const result = (() => {
      try {
        const stdout = execFileSync("node", [BIN, "owner/repo", "--no-spinner"], {
          encoding: "utf-8",
          timeout: 15_000,
          env: {
            GITHUB_TOKEN: "",
            GH_TOKEN: "",
            NODE_ENV: "test",
            HOME: process.env.HOME ?? "",
          },
        });
        return { stdout, code: 0 };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; status?: number };
        return {
          stdout: (e.stdout ?? "") + (e.stderr ?? ""),
          code: e.status ?? 1,
        };
      }
    })();

    // Should exit non-zero because no token is available
    expect(result.code).not.toBe(0);
  });
});
