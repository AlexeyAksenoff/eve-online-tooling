import { describe, expect, it } from "vitest";
import { computeFarmScores } from "./playstyle";
import type { FwSystemNode } from "../../lib/api";

function node(
  overrides: Partial<FwSystemNode> & { systemId: number },
): FwSystemNode {
  return {
    name: `Sys${overrides.systemId}`,
    region: "Region",
    warzone: "Amarr–Minmatar",
    security: 0.3,
    owner: "Amarr",
    occupier: "Amarr",
    ownerId: 500003,
    occupierId: 500003,
    contested: "contested",
    vpPct: 0.5,
    kills: 0,
    npcKills: 0,
    jumps: 0,
    battlefield: "frontline",
    vpVelocity: null,
    x: 0,
    z: 0,
    ...overrides,
  };
}

describe("computeFarmScores", () => {
  it("scores highest for high VP, low kills, low NPC kills, close hops", () => {
    const systems = [
      node({ systemId: 1, vpPct: 0.9, kills: 0, npcKills: 0 }),
      node({ systemId: 2, vpPct: 0.1, kills: 20, npcKills: 20 }),
    ];
    const dist = { "1": 1, "2": 1 };
    const scores = computeFarmScores(systems, dist, true);
    expect(scores[1]).toBeGreaterThan(scores[2]);
  });

  it("normalizes kills/npcKills/hops against the busiest/farthest system given", () => {
    const systems = [
      node({ systemId: 1, vpPct: 0.5, kills: 0, npcKills: 0 }),
      node({ systemId: 2, vpPct: 0.5, kills: 10, npcKills: 10 }),
    ];
    const dist = { "1": 0, "2": 5 };
    const scores = computeFarmScores(systems, dist, true);
    // System 1: 0 kills, 0 npc, 0 hops -> best on every non-VP term.
    // score = 0.4*0.5 + 0.25*1 + 0.2*1 + 0.15*1 = 0.2 + 0.25 + 0.2 + 0.15 = 0.8
    expect(scores[1]).toBeCloseTo(0.8, 5);
    // System 2: maxed out on every non-VP term (norm = 1 -> (1-norm) = 0).
    // score = 0.4*0.5 + 0 + 0 + 0 = 0.2
    expect(scores[2]).toBeCloseTo(0.2, 5);
  });

  it("redistributes the hops weight proportionally when no character is logged in", () => {
    const systems = [node({ systemId: 1, vpPct: 0.5, kills: 0, npcKills: 0 })];
    const scores = computeFarmScores(systems, {}, false);
    // Weight redistributed: 0.4/0.85, 0.25/0.85, 0.2/0.85 applied to
    // (vpPct, 1, 1) with hops term entirely absent.
    const scale = (0.4 + 0.25 + 0.2 + 0.15) / (0.4 + 0.25 + 0.2);
    const expected = 0.4 * scale * 0.5 + 0.25 * scale * 1 + 0.2 * scale * 1;
    expect(scores[1]).toBeCloseTo(expected, 5);
  });

  it("treats an unreachable system as maximally far rather than dropping it", () => {
    const systems = [
      node({ systemId: 1, vpPct: 0.5 }),
      node({ systemId: 2, vpPct: 0.5 }),
    ];
    // System 2 has no jump-distance entry (unreachable, e.g. contested data
    // lag) — should still score, just worst on the hops term.
    const scores = computeFarmScores(systems, { "1": 0 }, true);
    expect(scores[2]).toBeLessThan(scores[1]);
    expect(Number.isFinite(scores[2])).toBe(true);
  });
});
