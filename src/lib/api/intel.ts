import { invoke } from "@tauri-apps/api/core";

/** One active Sansha incursion. */
export interface IncursionRow {
  staging: string;
  constellation: string;
  faction: string;
  /** Remaining influence, 0 (about to end) … 1 (freshly spawned). */
  influence: number;
  /** The mothership has spawned — final stage, best payouts. */
  hasBoss: boolean;
  /** "established" | "mobilizing" | "withdrawing". */
  state: string;
  /** Infested systems in the constellation. */
  systems: number;
}

/** Active incursions, most-contested first. Public data, cached ~5 min. */
export function intelIncursions(): Promise<IncursionRow[]> {
  return invoke<IncursionRow[]>("intel_incursions");
}

/** One militia's faction-warfare standing. */
export interface FwRow {
  faction: string;
  /** "Caldari–Gallente" | "Amarr–Minmatar". */
  warzone: string;
  pilots: number;
  systemsControlled: number;
  killsYesterday: number;
  killsLastWeek: number;
  vpYesterday: number;
  vpLastWeek: number;
}

/** Faction-warfare militia stats, most systems held first. Public, cached ~10 min. */
export function intelFwStats(): Promise<FwRow[]> {
  return invoke<FwRow[]>("intel_fw_stats");
}

/** One faction-warfare system (control, contest state, activity). */
export interface FwSystemNode {
  systemId: number;
  name: string;
  region: string;
  /** "Caldari–Gallente" | "Amarr–Minmatar". */
  warzone: string;
  /** Security status (FW space is lowsec, ~0.1–0.4). */
  security: number;
  owner: string;
  occupier: string;
  ownerId: number;
  occupierId: number;
  /** "uncontested" | "contested" | "vulnerable" | "captured". */
  contested: string;
  /** Capture progress 0..1 (victory points / threshold). */
  vpPct: number;
  /** Ship + pod kills in the last hour. */
  kills: number;
  /** NPC (rat) kills in the last hour (#896) — a plexing-activity proxy:
   *  high NPC kills with low ship kills suggests active farming. */
  npcKills: number;
  /** Jumps in the last hour — traffic proxy (ESI has no live player count). */
  jumps: number;
  /** "frontline" | "commandops" | "rearguard" — derived from occupancy +
   *  stargate adjacency (#895); ESI exposes no battlefield classification. */
  battlefield: string;
  /** ΔVP%/hour (#899) over the last ~30 min of on-disk history, in the same
   *  0..1 units as `vpPct` (0.15 = 15 points/hour). Null until at least two
   *  samples exist, or right after an ownership flip resets the history. */
  vpVelocity: number | null;
  /** Galactic map-plane coordinates (seed the star-map layout). */
  x: number;
  z: number;
}

export interface FwMap {
  nodes: FwSystemNode[];
  /** Stargate edges `[a, b]` between FW systems. */
  edges: [number, number][];
}

/**
 * Every FW system with owner/occupier, contested state and capture progress,
 * plus last-hour kills/jumps and the stargate edges between them (warzone map).
 * Public data, cached ~5 min.
 */
export function fwSystems(): Promise<FwMap> {
  return invoke<FwMap>("intel_fw_systems");
}

/** Shortest stargate jump counts from the active character's current system to
 * each given FW system id. `jumps` is keyed by `String(systemId)`; absent =
 * unreachable (e.g. wormhole space). Requires a logged-in character with the
 * esi-location.read_location.v1 scope. */
export interface FwJumpResult {
  /** The system the character is currently in. */
  characterSystemId: number;
  /** Hop counts per system id (key = String(systemId)). */
  jumps: Record<string, number>;
}

export function intelFwJumps(systemIds: number[]): Promise<FwJumpResult> {
  return invoke<FwJumpResult>("intel_fw_jumps", { systemIds });
}

/** The active character's current faction-warfare militia (faction id), or
 * `null` if unenlisted, unauthenticated, or missing the
 * `esi-characters.read_fw_stats.v1` scope. Used to default the militia
 * picker; every failure mode collapses to `null` (Observer) rather than an
 * error. */
export function intelFwEnlistment(): Promise<number | null> {
  return invoke<number | null>("intel_fw_enlistment");
}

/** The active character's own FW record: militia, rank, kills, VP, and
 * enlistment date, for the perspective view's personal stats card. */
export interface FwPersonalStats {
  factionId: number;
  rankName: string;
  killsYesterday: number;
  killsTotal: number;
  vpYesterday: number;
  vpTotal: number;
  /** RFC-3339, or null if ESI omitted it. */
  enlistedOn: string | null;
}

export interface FwPersonalStatsResult {
  /** Null when unenlisted, unauthenticated, or a genuine ESI failure. */
  stats: FwPersonalStats | null;
  /** True specifically for a 403 (missing `esi-characters.read_fw_stats.v1`
   * — granted before this scope was added, needs a re-login). Distinct from
   * `stats: null` so the UI can show a "re-login to enable" hint instead of
   * silently hiding the card like the unenlisted case does. */
  missingScope: boolean;
}

/** The active character's personal FW record, cached ~10 min. */
export function intelFwPersonalStats(): Promise<FwPersonalStatsResult> {
  return invoke<FwPersonalStatsResult>("intel_fw_personal_stats");
}
