import type { KillEvent } from "../../lib/api";

/** Every corp/alliance id a kill event touches — victim and attackers alike
 *  — for matching against Local Intel's watchlist (corp/alliance-scoped,
 *  not character-scoped: see `WatchEntry`). */
export function killEventEntityIds(event: KillEvent): number[] {
  const ids: number[] = [];
  if (event.victimCorporationId != null) ids.push(event.victimCorporationId);
  if (event.victimAllianceId != null) ids.push(event.victimAllianceId);
  ids.push(...event.attackerCorporationIds, ...event.attackerAllianceIds);
  return ids;
}

/** Does this live kill event touch a watched corp/alliance, as victim or
 *  attacker? */
export function matchesWatchlist(
  event: KillEvent,
  watchIds: ReadonlySet<number>,
): boolean {
  return killEventEntityIds(event).some((id) => watchIds.has(id));
}

/** Cooldown gate so a fight involving several watched-corp kills in quick
 *  succession produces one live notification, not a flood — same shape as
 *  the FW home-defense provider's `shouldTriggerLiveRefetch` (#926). */
export function shouldNotifyLiveWatch(
  lastNotifiedAtMs: number,
  nowMs: number,
  cooldownMs: number,
): boolean {
  return nowMs - lastNotifiedAtMs >= cooldownMs;
}

/** Should a live kill event trigger a top-up refetch of the currently
 *  scanned system's kill panel? Only when it's actually in that system. */
export function matchesScannedSystem(
  event: KillEvent,
  scannedSystemId: number | null,
): boolean {
  return scannedSystemId != null && event.solarSystemId === scannedSystemId;
}
