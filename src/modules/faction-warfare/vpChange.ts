/**
 * Pure faction-signed VP-change logic: turns the occupier-centric raw VP%
 * deltas the backend/session tracks into "is this good or bad for my
 * militia" numbers for the FW table's Δ30m/Δ login columns.
 *
 * `vpPct`/`vpVelocity`/`vpDelta30m` on a `FwSystemNode` always track the
 * *occupier's* progress (ESI's `victory_points`, whoever currently holds or
 * is contesting the system) — a rising number is good for the occupier,
 * regardless of who that is. From a selected militia's perspective that's
 * only good news if *they're* the occupier; if the enemy is occupying and
 * gaining ground, the same positive raw number is bad news. `factionSignedDelta`
 * does that sign flip; the two sources of raw delta (the backend's rolling
 * ~30-min sample history, and this session's own login-time baseline) are
 * handled identically once flipped.
 */
import type { FwSystemNode } from "../../lib/api";
import { enemyFaction, type MilitiaFactionId } from "./factionPerspective";

/** A system's VP baseline for the "since login" column: the occupier and
 *  VP% the first time this app session observed it, or re-anchored after an
 *  ownership flip — pre-flip VP is meaningless once the occupier changes,
 *  mirroring the backend's ~30-min history reset on flip (`update_vp_history`). */
export interface VpLoginBaseline {
  occupierId: number;
  vpPct: number;
}

/** Fold the latest poll into the "since login" baseline map: a system seen
 *  for the first time this session is anchored at its current VP; a system
 *  whose occupier changed since its baseline was captured is re-anchored.
 *  Every other system keeps its original baseline untouched, so its delta
 *  keeps accumulating across every poll for the rest of the session. Call
 *  this on every fresh `FwMap` and keep the result for the next call (same
 *  calling convention as `homeDefenseAlerts.ts`'s `snapshotSystems`). */
export function updateLoginBaselines(
  baseline: ReadonlyMap<number, VpLoginBaseline>,
  systems: readonly FwSystemNode[],
): Map<number, VpLoginBaseline> {
  const next = new Map(baseline);
  for (const s of systems) {
    const existing = next.get(s.systemId);
    if (!existing || existing.occupierId !== s.occupierId) {
      next.set(s.systemId, { occupierId: s.occupierId, vpPct: s.vpPct });
    }
  }
  return next;
}

/** Raw (occupier-centric) VP% change since the session's baseline for one
 *  system, or `null` if it has no baseline yet (first poll this session). */
export function loginDelta(
  baseline: ReadonlyMap<number, VpLoginBaseline>,
  systemId: number,
  currentVpPct: number,
): number | null {
  const base = baseline.get(systemId);
  return base ? currentVpPct - base.vpPct : null;
}

/** Faction-signed VP%-change for the selected militia's perspective: positive
 *  is progress for `myFaction` regardless of which faction actually holds or
 *  is contesting the system. `rawDelta` is occupier-centric — a gain for the
 *  occupier only helps `myFaction` if the occupier *is* `myFaction`; against
 *  the enemy occupier it's a loss, so the sign flips. An occupier that's
 *  neither mine nor my direct enemy has no defined sign here (the map is
 *  public and could in principle show the other warzone), so this returns
 *  `null` rather than guessing. */
export function factionSignedDelta(
  rawDelta: number | null,
  occupierId: number,
  myFaction: MilitiaFactionId,
): number | null {
  if (rawDelta == null) return null;
  if (occupierId === myFaction) return rawDelta;
  if (occupierId === enemyFaction(myFaction)) return -rawDelta;
  return null;
}

/** Display text for a faction-signed VP% delta: "+4.2%" / "−1.8%" / "0.0%",
 *  or "—" with no baseline yet. Deltas under 0.05 points read as flat rather
 *  than printing a misleading "+0.0%"/"-0.0%". */
export function formatVpDeltaPct(delta: number | null): string {
  if (delta == null) return "—";
  const pct = delta * 100;
  if (Math.abs(pct) < 0.05) return "0.0%";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}
