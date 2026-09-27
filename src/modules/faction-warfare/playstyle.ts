import type { FwSystemNode } from "../../lib/api";

/**
 * Playstyle presets (#904): "all" is today's behaviour (unfiltered,
 * user-controlled sort). "pvp" and "plexing" re-sort/re-filter the existing
 * view — they aren't separate pages.
 */
export type Playstyle = "all" | "pvp" | "plexing";
export const PLAYSTYLE_OPTIONS: readonly { key: Playstyle; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pvp", label: "PvP" },
  { key: "plexing", label: "Plexing" },
];

/**
 * v1 farm-score weights for Plexing mode — expected to be tuned once real
 * warzone data shows what "good" actually looks like. High contest progress,
 * few ship kills (safe), few NPC kills (little farming competition already
 * there), close to me:
 *
 *   score = 0.4·vpPct + 0.25·(1−killsNorm) + 0.2·(1−npcKillsNorm) + 0.15·(1−hopsNorm)
 *
 * Each `*Norm` term is normalized 0..1 against the busiest/farthest system in
 * the candidate set passed in (already filtered to frontline/command-ops by
 * the caller) — "normalized per warzone" per the spec. The hops term drops
 * out (weight redistributed proportionally onto the other three) when no
 * character is logged in, since there is no "close to me" to measure.
 */
const FARM_WEIGHTS = { vp: 0.4, kills: 0.25, npcKills: 0.2, hops: 0.15 };

/** Farm score per system id, for sorting Plexing mode. `hasCharacter` gates
 *  whether the hops term applies (its weight redistributes onto the rest
 *  when there's no character to measure distance from). */
export function computeFarmScores(
  systems: FwSystemNode[],
  dist: Record<string, number>,
  hasCharacter: boolean,
): Record<number, number> {
  const maxKills = Math.max(1, ...systems.map((s) => s.kills));
  const maxNpcKills = Math.max(1, ...systems.map((s) => s.npcKills));
  const hopsOf = (s: FwSystemNode) => dist[String(s.systemId)];
  const maxHops = hasCharacter
    ? Math.max(1, ...systems.map((s) => hopsOf(s) ?? 0))
    : 1;

  // Redistribute the hops weight proportionally onto the other three terms
  // when there's no character — each keeps its relative share of the
  // remaining weight (e.g. vp: 0.4 / 0.85 of the total instead of 0.4).
  const remaining =
    FARM_WEIGHTS.vp + FARM_WEIGHTS.kills + FARM_WEIGHTS.npcKills;
  const scale = hasCharacter ? 1 : (remaining + FARM_WEIGHTS.hops) / remaining;
  const wVp = FARM_WEIGHTS.vp * scale;
  const wKills = FARM_WEIGHTS.kills * scale;
  const wNpcKills = FARM_WEIGHTS.npcKills * scale;
  const wHops = hasCharacter ? FARM_WEIGHTS.hops : 0;

  const scores: Record<number, number> = {};
  for (const s of systems) {
    const killsNorm = s.kills / maxKills;
    const npcKillsNorm = s.npcKills / maxNpcKills;
    const hops = hopsOf(s);
    // Unreachable (no jump data) systems score as if maximally far, rather
    // than dropping the hops term entirely — still rankable, just last.
    const hopsNorm = hasCharacter ? (hops ?? maxHops) / maxHops : 0;
    scores[s.systemId] =
      wVp * s.vpPct +
      wKills * (1 - killsNorm) +
      wNpcKills * (1 - npcKillsNorm) +
      wHops * (1 - hopsNorm);
  }
  return scores;
}
