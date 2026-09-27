/**
 * Pure VP-trend display logic for the contest-velocity feature (#899).
 * `vpVelocity` is expressed in the same 0..1 units as `vpPct` — 0.15 means
 * 15 percentage points per hour. Thresholds below are v1 tuning, expected to
 * be revisited once real warzone data shows what "fast" actually looks like.
 */

const STABLE_THRESHOLD = 0.02; // ±2 %/hour reads as "holding"
const FAST_THRESHOLD = 0.1; // ≥10 %/hour reads as "fast"

export type TrendTier = "fast-up" | "up" | "stable" | "down" | null;

/** `null` when there's no velocity yet (fewer than two samples, or a system
 *  that just changed hands) — callers should hide the arrow entirely. */
export function trendTier(vpVelocity: number | null): TrendTier {
  if (vpVelocity == null) return null;
  if (vpVelocity >= FAST_THRESHOLD) return "fast-up";
  if (vpVelocity > STABLE_THRESHOLD) return "up";
  if (vpVelocity >= -STABLE_THRESHOLD) return "stable";
  return "down";
}

export const TREND_ARROW: Record<Exclude<TrendTier, null>, string> = {
  "fast-up": "↑↑",
  up: "↑",
  stable: "→",
  down: "↓",
};

/** Hours until this system reaches full capture (vpPct = 1) at the current
 *  rate, or `null` when there's no velocity or it isn't climbing (a falling
 *  or flat system has no meaningful ETA to flip). */
export function etaHours(
  vpPct: number,
  vpVelocity: number | null,
): number | null {
  if (vpVelocity == null || vpVelocity <= 0) return null;
  return (1 - vpPct) / vpVelocity;
}

/** Compact tooltip text: the rate as %/hour, plus an ETA when climbing. */
export function trendTooltip(vpPct: number, vpVelocity: number | null): string {
  if (vpVelocity == null) return "Not enough history yet";
  const rate = `${vpVelocity >= 0 ? "+" : ""}${(vpVelocity * 100).toFixed(1)}%/h`;
  const eta = etaHours(vpPct, vpVelocity);
  return eta != null ? `${rate} · ≈${eta.toFixed(1)}h to flip` : rate;
}
