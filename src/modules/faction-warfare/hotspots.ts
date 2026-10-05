import type { HotspotSystemCounts } from "../../lib/api";

/** Map heat-layer selection (#905): mutually exclusive with each other and
 *  with the default kill-heat tint — "off" restores today's behaviour. */
export type HeatLayer = "off" | "friendly" | "enemy" | "cartel";

export const HEAT_LAYER_OPTIONS: readonly { key: HeatLayer; label: string }[] =
  [
    { key: "off", label: "Off" },
    { key: "friendly", label: "Our losses" },
    { key: "enemy", label: "Their losses" },
    { key: "cartel", label: "Cartel activity" },
  ];

/** The three raw hotspot counts a system can carry (dropping `systemId` —
 *  callers already have it from the `FwSystemNode` they're joining onto). */
type HotspotCounts = Pick<
  HotspotSystemCounts,
  "friendlyLosses" | "enemyLosses" | "cartelActivity"
>;

/** The count a given heat layer paints with; 0 (no tint) for "off". */
export function heatCount(row: HotspotCounts, layer: HeatLayer): number {
  switch (layer) {
    case "friendly":
      return row.friendlyLosses;
    case "enemy":
      return row.enemyLosses;
    case "cartel":
      return row.cartelActivity;
    case "off":
      return 0;
  }
}

const HEAT_LAYER_RGB: Record<
  Exclude<HeatLayer, "off">,
  [number, number, number]
> = {
  friendly: [220, 38, 38], // rose/red — danger: this is where we're dying
  enemy: [16, 185, 129], // emerald — good news: this is where we're winning
  cartel: [168, 85, 247], // purple — NPC insurgency kill activity
};

/** Tile background for the active heat layer, deepening from `baseRgb`
 *  (typically the contested-state base tint — the layer replaces the kill
 *  heat, not the contest colouring) toward that layer's own colour as
 *  `count` approaches the warzone's busiest system for it. 0 leaves the
 *  tile untinted (returns `undefined`, matching `tileBg`'s convention). */
export function heatBg(
  baseRgb: readonly [number, number, number],
  count: number,
  maxCount: number,
  layer: Exclude<HeatLayer, "off">,
): string | undefined {
  if (count <= 0) return undefined;
  const t = Math.min(1, count / Math.max(3, maxCount)) * 0.85;
  const rgb = HEAT_LAYER_RGB[layer];
  const mix = baseRgb.map((c, i) => Math.round(c + (rgb[i] - c) * t));
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
