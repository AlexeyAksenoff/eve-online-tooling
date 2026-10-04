import { describe, expect, it } from "vitest";
import { nearestFriendlyFrontline } from "./frontlineRoute";
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
    vpDelta30m: null,
    x: 0,
    z: 0,
    ...overrides,
  };
}

describe("nearestFriendlyFrontline", () => {
  it("returns null when no friendly frontline is reachable", () => {
    const systems = [
      node({ systemId: 1, occupierId: 500002, battlefield: "frontline" }), // enemy's
      node({ systemId: 2, occupierId: 500003, battlefield: "commandops" }), // mine, not frontline
    ];
    expect(
      nearestFriendlyFrontline(systems, { "1": 2, "2": 1 }, 500003),
    ).toBeNull();
  });

  it("returns null when the only friendly frontline is unreachable (absent from dist)", () => {
    const systems = [
      node({ systemId: 1, occupierId: 500003, battlefield: "frontline" }),
    ];
    expect(nearestFriendlyFrontline(systems, {}, 500003)).toBeNull();
  });

  it("picks the fewest-hops friendly frontline", () => {
    const systems = [
      node({
        systemId: 1,
        occupierId: 500003,
        battlefield: "frontline",
        kills: 0,
      }),
      node({
        systemId: 2,
        occupierId: 500003,
        battlefield: "frontline",
        kills: 0,
      }),
    ];
    const result = nearestFriendlyFrontline(
      systems,
      { "1": 5, "2": 2 },
      500003,
    );
    expect(result?.systemId).toBe(2);
  });

  it("breaks a hop-count tie toward fewer ship kills (safer arrival)", () => {
    const systems = [
      node({
        systemId: 1,
        occupierId: 500003,
        battlefield: "frontline",
        kills: 10,
      }),
      node({
        systemId: 2,
        occupierId: 500003,
        battlefield: "frontline",
        kills: 1,
      }),
    ];
    const result = nearestFriendlyFrontline(
      systems,
      { "1": 3, "2": 3 },
      500003,
    );
    expect(result?.systemId).toBe(2);
  });

  it("ignores enemy-held and non-frontline systems even if closer", () => {
    const systems = [
      node({ systemId: 1, occupierId: 500002, battlefield: "frontline" }), // enemy, 1j
      node({ systemId: 2, occupierId: 500003, battlefield: "commandops" }), // mine but not frontline, 1j
      node({ systemId: 3, occupierId: 500003, battlefield: "frontline" }), // mine, frontline, 4j
    ];
    const result = nearestFriendlyFrontline(
      systems,
      { "1": 1, "2": 1, "3": 4 },
      500003,
    );
    expect(result?.systemId).toBe(3);
  });
});
