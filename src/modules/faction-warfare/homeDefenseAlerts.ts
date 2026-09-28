import type { FwSystemNode } from "../../lib/api";
import { relationshipFor, type MilitiaFactionId } from "./factionPerspective";

/** "off" disables the nearby-flip rule entirely — the radius picker doubles
 *  as that rule's toggle, per the settings UI in #907. */
export type NearbyFlipRadius = "3" | "5" | "10" | "off";

export interface HomeDefenseSettings {
  vulnerableAlertOn: boolean;
  nearbyFlipRadius: NearbyFlipRadius;
}

export interface HomeDefenseAlert {
  kind: "vulnerable" | "flip";
  systemId: number;
  systemName: string;
  contested: string;
}

/** The minimal per-system fields a transition can occur on — everything the
 *  detector needs to diff between polls. */
export interface SystemStateSnapshot {
  contested: string;
  occupierId: number;
}

export function snapshotSystems(
  systems: FwSystemNode[],
): Map<number, SystemStateSnapshot> {
  return new Map(
    systems.map((s) => [
      s.systemId,
      { contested: s.contested, occupierId: s.occupierId },
    ]),
  );
}

/**
 * Edge-triggered detector (#907): compares this poll's systems against the
 * previous poll's snapshot and returns alerts only for genuine state
 * TRANSITIONS observed this poll — never for state that already held last
 * poll, so a refetch that returns identical data (or a system that's been
 * vulnerable for hours) never re-alerts.
 *
 * `prev === null` means there's no prior snapshot (first poll after mount or
 * an app restart) — always returns no alerts, since whatever state we
 * observe first could already have existed before we started watching; only
 * observed *changes* should notify. Call {@link snapshotSystems} on `curr`
 * after every call (including this baseline one) and keep it for the next.
 *
 * A system absent from `prev` (e.g. it just appeared in the FW system list)
 * is likewise treated as having no prior state to diff — skipped, not
 * alerted, for the same reason.
 */
export function detectHomeDefenseAlerts(
  prev: Map<number, SystemStateSnapshot> | null,
  curr: FwSystemNode[],
  myFaction: MilitiaFactionId,
  dist: Record<string, number>,
  settings: HomeDefenseSettings,
): HomeDefenseAlert[] {
  if (prev === null) return [];
  const alerts: HomeDefenseAlert[] = [];
  const radius =
    settings.nearbyFlipRadius === "off"
      ? null
      : Number(settings.nearbyFlipRadius);

  for (const s of curr) {
    const before = prev.get(s.systemId);
    if (!before) continue;

    if (
      settings.vulnerableAlertOn &&
      relationshipFor(s.occupierId, myFaction) === "friendly" &&
      before.contested !== "vulnerable" &&
      s.contested === "vulnerable"
    ) {
      alerts.push({
        kind: "vulnerable",
        systemId: s.systemId,
        systemName: s.name,
        contested: s.contested,
      });
    }

    if (radius !== null && before.contested !== s.contested) {
      const hops = dist[String(s.systemId)];
      if (hops != null && hops <= radius) {
        alerts.push({
          kind: "flip",
          systemId: s.systemId,
          systemName: s.name,
          contested: s.contested,
        });
      }
    }
  }
  return alerts;
}

/**
 * Should a live kill event (#924, #926) trigger an eager re-check of FW
 * system state, ahead of whatever polling cadence is already scheduled?
 *
 * Important honesty check: a kill happening does **not by itself** mean a
 * system went vulnerable or flipped contested state — that's driven by FW
 * campaign VP thresholds, which only `/fw/systems/` exposes, not zKill.
 * What a kill *does* mean is "something is happening here right now", which
 * strongly correlates with a contested-state change being imminent or
 * already underway — worth checking sooner rather than waiting for the next
 * scheduled poll. This function only decides *whether it's worth asking
 * again right now*; the actual transition detection still happens via
 * {@link detectHomeDefenseAlerts} against freshly-fetched data afterward.
 *
 * Gated two ways: the event must be in a system the caller cares about
 * (`watchedSystemIds` — typically the militia's whole warzone), and a
 * cooldown prevents a kill flurry (a real fight easily produces several
 * kills a minute) from re-triggering an ESI fetch on every single one.
 */
export function shouldTriggerLiveRefetch(
  eventSystemId: number,
  watchedSystemIds: ReadonlySet<number>,
  lastTriggeredAtMs: number,
  nowMs: number,
  cooldownMs: number,
): boolean {
  if (!watchedSystemIds.has(eventSystemId)) return false;
  return nowMs - lastTriggeredAtMs >= cooldownMs;
}
