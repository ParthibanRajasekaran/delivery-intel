import { describe, it, expect, vi, afterEach } from "vitest";
import { bucketLast7Days } from "../cli/analyzer";

/**
 * Pin "now" so tests are deterministic regardless of when they run.
 * We set today = 2026-02-20T12:00:00Z.
 */
const NOW = new Date("2026-02-20T12:00:00Z");

describe("bucketLast7Days", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function withFakeTime(fn: () => void) {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fn();
  }

  it("returns 7-element array of zeros for empty input", () => {
    withFakeTime(() => {
      expect(bucketLast7Days([])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });
  });

  it("counts today's events in the last bucket (index 6)", () => {
    withFakeTime(() => {
      const today = new Date("2026-02-20T08:00:00Z");
      expect(bucketLast7Days([today])).toEqual([0, 0, 0, 0, 0, 0, 1]);
    });
  });

  it("counts events from 6 days ago in the first bucket (index 0)", () => {
    withFakeTime(() => {
      const sixDaysAgo = new Date("2026-02-14T10:00:00Z");
      expect(bucketLast7Days([sixDaysAgo])).toEqual([1, 0, 0, 0, 0, 0, 0]);
    });
  });

  it("excludes events from exactly 7 days ago (out of range)", () => {
    withFakeTime(() => {
      const sevenDaysAgo = new Date("2026-02-13T08:00:00Z");
      expect(bucketLast7Days([sevenDaysAgo])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });
  });

  it("excludes future dates", () => {
    withFakeTime(() => {
      const tomorrow = new Date("2026-02-21T08:00:00Z");
      expect(bucketLast7Days([tomorrow])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });
  });

  it("distributes multiple events across correct day buckets", () => {
    withFakeTime(() => {
      const dates = [
        new Date("2026-02-20T09:00:00Z"), // today  → bucket 6
        new Date("2026-02-20T11:00:00Z"), // today  → bucket 6
        new Date("2026-02-18T06:00:00Z"), // 2 days → bucket 4
        new Date("2026-02-16T10:00:00Z"), // 4 days → bucket 2
      ];
      expect(bucketLast7Days(dates)).toEqual([0, 0, 1, 0, 1, 0, 2]);
    });
  });

  it("handles dates far in the past (>7 days)", () => {
    withFakeTime(() => {
      const old = new Date("2025-01-01T00:00:00Z");
      expect(bucketLast7Days([old])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });
  });
});
