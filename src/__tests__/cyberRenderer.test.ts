import { describe, it, expect } from "vitest";
import { sparkline } from "../cli/cyberRenderer";

// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp("\x1b\\[[0-9;]*m", "g");

/** Strip ANSI escape codes to get raw visible text */
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

describe("sparkline", () => {
  it("renders 7-character output for 7-value input", () => {
    const raw = stripAnsi(sparkline([0, 1, 2, 3, 4, 5, 6]));
    expect(raw).toHaveLength(7);
  });

  it("uses block characters ▁–█", () => {
    const raw = stripAnsi(sparkline([0, 0, 0, 0, 0, 0, 7]));
    // Highest value should get the tallest bar
    expect(raw[6]).toBe("█");
  });

  it("handles all-zero values without dividing by zero", () => {
    const raw = stripAnsi(sparkline([0, 0, 0, 0, 0, 0, 0]));
    expect(raw).toHaveLength(7);
  });

  it("handles uniform values", () => {
    const raw = stripAnsi(sparkline([3, 3, 3, 3, 3, 3, 3]));
    // All same value → all same bar height (max bar)
    expect(new Set(raw.split("")).size).toBe(1);
  });
});
