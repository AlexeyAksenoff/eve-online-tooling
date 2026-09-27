/**
 * Pure faction-perspective logic for the FW page's militia picker (#901).
 * Kept dependency-free so it's trivially unit-tested — the page wires this
 * into the militia picker, summary strip, table and map.
 */

/** The four faction-warfare militia faction ids. */
export type MilitiaFactionId = 500001 | 500002 | 500003 | 500004;

const MILITIA_IDS: readonly MilitiaFactionId[] = [
  500001, 500004, 500003, 500002,
];

/** True if `id` is one of the four militia factions (narrows the type). */
export function isMilitiaFaction(id: number): id is MilitiaFactionId {
  return (MILITIA_IDS as readonly number[]).includes(id);
}

/** The warzone a militia fights in. Mirrors the Rust `warzone()` in
 *  `intel/commands.rs` — keep the two in sync if the militia list changes. */
export function warzoneForFaction(id: MilitiaFactionId): string {
  return id === 500001 || id === 500004 ? "Caldari–Gallente" : "Amarr–Minmatar";
}

/** The opposing militia in the same warzone. */
export function enemyFaction(id: MilitiaFactionId): MilitiaFactionId {
  switch (id) {
    case 500001:
      return 500004;
    case 500004:
      return 500001;
    case 500003:
      return 500002;
    case 500002:
      return 500003;
  }
}

/** Faction id → display name, for mapping the militia-stats endpoint's name
 *  field back to an id (that endpoint has no faction id of its own). */
export const MILITIA_NAME: Record<MilitiaFactionId, string> = {
  500001: "Caldari State",
  500004: "Gallente Federation",
  500003: "Amarr Empire",
  500002: "Minmatar Republic",
};

const MILITIA_ID_BY_NAME: Record<string, MilitiaFactionId> = {
  "Caldari State": 500001,
  "Gallente Federation": 500004,
  "Amarr Empire": 500003,
  "Minmatar Republic": 500002,
};

/** Resolve a militia stats row's faction *name* back to its id, or `null`
 *  for anything outside the four militias. */
export function militiaIdByName(name: string): MilitiaFactionId | null {
  return MILITIA_ID_BY_NAME[name] ?? null;
}

/** A system's relationship to the selected militia, from the perspective
 *  reframe: "defend" (mine, under active contest), "push" (the enemy's,
 *  under active contest), or `null` (not contested, or neither side). */
export type Perspective = "defend" | "push" | null;

export function perspectiveFor(
  occupierId: number,
  contested: string,
  myFaction: MilitiaFactionId,
): Perspective {
  if (contested === "uncontested") return null;
  if (occupierId === myFaction) return "defend";
  if (occupierId === enemyFaction(myFaction)) return "push";
  return null;
}

/** Map-tile/legend relationship bucket for an occupier, from the selected
 *  militia's perspective. Any occupier that is neither mine nor my direct
 *  enemy (e.g. a pirate-cartel occupier, once ESI exposes one) buckets as
 *  "cartel" rather than "hostile" — it isn't the militia I'm at war with. */
export type Relationship = "friendly" | "hostile" | "cartel";

export function relationshipFor(
  occupierId: number,
  myFaction: MilitiaFactionId,
): Relationship {
  if (occupierId === myFaction) return "friendly";
  if (occupierId === enemyFaction(myFaction)) return "hostile";
  return "cartel";
}
