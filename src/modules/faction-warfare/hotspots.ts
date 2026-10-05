import type { HotspotSystemCounts } from "../../lib/api";

/** The three raw hotspot counts a system can carry (dropping `systemId` —
 *  callers already have it from the `FwSystemNode` they're joining onto). */
type HotspotCounts = Pick<
  HotspotSystemCounts,
  "friendlyLosses" | "enemyLosses" | "cartelActivity"
>;

/** Colour the kill-activity heat deepens toward — one fixed hue now that
 *  there's a single always-on heat view (total faction-scoped activity)
 *  instead of a friendly/enemy/cartel layer picker. */
const HOTSPOT_HEAT_RGB: [number, number, number] = [220, 38, 38]; // rose

/** Tile background for a system's total faction-scoped kill activity
 *  (friendly losses + enemy losses + cartel activity, last ~6h) —
 *  deepens from `baseRgb` (typically the contested-state tint — this
 *  replaces the generic ESI kill-count heat, not the contest colouring)
 *  toward the heat colour as `total` approaches the warzone's busiest
 *  system. 0 leaves the tile untinted (returns `undefined`, matching
 *  `tileBg`'s convention). */
export function hotspotHeatBg(
  baseRgb: readonly [number, number, number],
  total: number,
  maxTotal: number,
): string | undefined {
  if (total <= 0) return undefined;
  const t = Math.min(1, total / Math.max(3, maxTotal)) * 0.85;
  const mix = baseRgb.map((c, i) =>
    Math.round(c + (HOTSPOT_HEAT_RGB[i] - c) * t),
  );
  return `rgb(${mix.join(",")})`;
}

/** A zero-count placeholder for a system the hotspots query hasn't resolved
 *  (or hasn't loaded yet) — lets callers look a system up in the counts map
 *  and always get a real object back instead of threading `undefined`
 *  through every consumer. */
export const NO_HOTSPOT_ACTIVITY: HotspotCounts = {
  friendlyLosses: 0,
  enemyLosses: 0,
  cartelActivity: 0,
};

/** Total activity across all three buckets — the sortable/"how hot is
 *  this system" number for the system table's Activity column. */
export function hotspotTotal(row: HotspotCounts): number {
  return row.friendlyLosses + row.enemyLosses + row.cartelActivity;
}

/** Compact "N ours · N theirs · N cartel" description for the system
 *  table's Activity column — omits zero terms so a quiet system reads as a
 *  plain dash instead of "0 ours · 0 theirs · 0 cartel". */
export function hotspotDescription(row: HotspotCounts): string {
  const parts: string[] = [];
  if (row.friendlyLosses > 0) parts.push(`${row.friendlyLosses} ours`);
  if (row.enemyLosses > 0) parts.push(`${row.enemyLosses} theirs`);
  if (row.cartelActivity > 0) parts.push(`${row.cartelActivity} cartel`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}
