import type { FwSystemNode, HotspotSystemCounts } from "../../lib/api";

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

export interface HotspotRow {
  systemId: number;
  systemName: string;
  friendlyLosses: number;
  enemyLosses: number;
  cartelActivity: number;
  hops: number | null;
}

/** The count a given heat layer paints with; 0 (no tint) for "off". */
export function heatCount(
  row: Pick<HotspotRow, "friendlyLosses" | "enemyLosses" | "cartelActivity">,
  layer: HeatLayer,
): number {
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

/**
 * Join hotspot counts onto the warzone's known systems (dropping any counts
 * for systems outside it — a militia pilot dying elsewhere in the cluster
 * isn't part of "where is my militia fighting in this warzone"), rank by
 * total activity across all three buckets, and take the top `limit`. Ties
 * break toward the closer system.
 */
export function rankHotspots(
  systems: FwSystemNode[],
  counts: HotspotSystemCounts[],
  dist: Record<string, number>,
  limit = 8,
): HotspotRow[] {
  const bySystem = new Map(systems.map((s) => [s.systemId, s]));
  const rows: HotspotRow[] = counts
    .filter((c) => bySystem.has(c.systemId))
    .map((c) => ({
      systemId: c.systemId,
      systemName: bySystem.get(c.systemId)!.name,
      friendlyLosses: c.friendlyLosses,
      enemyLosses: c.enemyLosses,
      cartelActivity: c.cartelActivity,
      hops: dist[String(c.systemId)] ?? null,
    }));
  rows.sort((a, b) => {
    const total = (r: HotspotRow) =>
      r.friendlyLosses + r.enemyLosses + r.cartelActivity;
    return (
      total(b) - total(a) ||
      (a.hops ?? Infinity) - (b.hops ?? Infinity) ||
      a.systemName.localeCompare(b.systemName)
    );
  });
  return rows.slice(0, limit);
}
