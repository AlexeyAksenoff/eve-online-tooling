import type { MilitiaFactionId } from "./factionPerspective";

/** Each militia's "home" LP store — the NPC corp whose offers a member
 *  redeems plexing LP against. Corporation ids from EVE's static data
 *  (verified against zkillboard/evewho, which mirror the SDE 1:1):
 *  https://zkillboard.com/corporation/1000180/ (State Protectorate)
 *  https://zkillboard.com/corporation/1000182/ (Tribal Liberation Force)
 *  https://zkillboard.com/corporation/1000179/ (24th Imperial Crusade)
 *  https://zkillboard.com/corporation/1000181/ (Federal Defence Union) */
export const MILITIA_LP_CORP_ID: Record<MilitiaFactionId, number> = {
  500001: 1000180, // Caldari State -> State Protectorate
  500002: 1000182, // Minmatar Republic -> Tribal Liberation Force
  500003: 1000179, // Amarr Empire -> 24th Imperial Crusade
  500004: 1000181, // Gallente Federation -> Federal Defence Union
};

/** LP payout multiplier by battlefield class. Verified against CCP's patch
 *  notes: frontline/command-ops rates are unchanged since Uprising (Nov
 *  2022) — https://www.eveonline.com/news/view/patch-notes-version-20-10 —
 *  but rearguard was cut from 0.5x to 0.01x in patch 21.05 (Aug 2023) to
 *  discourage automated farming of "safe" systems:
 *  https://www.eveonline.com/news/view/patch-notes-version-21-05 */
export const BATTLEFIELD_LP_MULTIPLIER: Record<string, number> = {
  frontline: 1.5,
  commandops: 1.0,
  rearguard: 0.01,
};

/** Baseline assumption for the estimate: a Medium ADV-1 complex (cruiser-
 *  and-below, the most commonly farmed mid-tier site), base 25,000 LP for a
 *  ~15 minute capture. This is a representative mid-tier site, not the
 *  theoretical maximum (Large/Battlefield sites pay more per capture but are
 *  rarer and take a fleet). Source: Minmatar Fleet FW Plexing Guide LP table
 *  (my.minmatar.org/learning/guides/faction-warfare-plexing/), cross-checked
 *  against EVE University's Faction warfare strategy and tactics page. */
export const ASSUMED_BASE_LP_PER_CAPTURE = 25_000;
export const ASSUMED_CAPTURE_MINUTES = 15;

/** ISK/h estimate for solo-plexing a given battlefield class, given the
 *  best ISK-per-LP conversion rate available at the militia's home LP
 *  store (from the existing lp-store module's `lpOffers` — not recomputed
 *  here). Returns 0 for an unrecognised battlefield class. */
export function plexingIskPerHour(
  battlefield: string,
  bestIskPerLp: number,
): number {
  const multiplier = BATTLEFIELD_LP_MULTIPLIER[battlefield] ?? 0;
  const lpPerHour =
    (ASSUMED_BASE_LP_PER_CAPTURE / ASSUMED_CAPTURE_MINUTES) * 60;
  return lpPerHour * multiplier * bestIskPerLp;
}
