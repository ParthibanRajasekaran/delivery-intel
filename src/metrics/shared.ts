// ============================================================================
// Shared math helpers for metric engines
// ============================================================================

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export function differenceInHours(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / (1000 * 60 * 60);
}

/**
 * Bucket events into per-day counts for the last N days.
 * Returns an array of length N where index 0 = (N-1) days ago, index (N-1) = today.
 */
export function bucketByDay(dates: Date[], days = 7): number[] {
  const now = new Date();
  const buckets = new Array<number>(days).fill(0);
  for (const d of dates) {
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays < days) {
      buckets[days - 1 - diffDays]++;
    }
  }
  return buckets;
}
