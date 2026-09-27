import type { FwSystemNode } from "../../lib/api";
import type { MilitiaFactionId } from "./factionPerspective";

/**
 * The nearest friendly frontline system by hop count (#908), or `null` when
 * no friendly frontline is reachable (no jump data, or none held). Ties on
 * hop count break toward fewer ship kills — a quieter arrival is a safer one.
 */
export function nearestFriendlyFrontline(
  systems: FwSystemNode[],
  dist: Record<string, number>,
  myFaction: MilitiaFactionId,
): FwSystemNode | null {
  let best: FwSystemNode | null = null;
  let bestHops = Infinity;
  for (const s of systems) {
    if (s.occupierId !== myFaction || s.battlefield !== "frontline") continue;
    const hops = dist[String(s.systemId)];
    if (hops == null) continue;
    if (
      hops < bestHops ||
      (hops === bestHops && best != null && s.kills < best.kills)
    ) {
      best = s;
      bestHops = hops;
    }
  }
  return best;
}
