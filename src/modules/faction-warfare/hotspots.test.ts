import { describe, expect, it } from "vitest";
import { heatBg, heatCount, rankHotspots } from "./hotspots";
import type { FwSystemNode, HotspotSystemCounts } from "../../lib/api";

function node(id: number, name: string): FwSystemNode {
  return {
    systemId: id,
    name,
    region: "Devoid",
    warzone: "Amarr–Minmatar",
    security: 0.3,
    owner: "Amarr",
    occupier: "Amarr",
    ownerId: 500003,
    occupierId: 500003,
    contested: "uncontested",
    vpPct: 0,
    kills: 0,
    npcKills: 0,
    jumps: 0,
    battlefield: "frontline",
    vpVelocity: null,
    vpDelta30m: null,
    x: 0,
    z: 0,
  };
}

function counts(
  systemId: number,
  overrides: Partial<HotspotSystemCounts> = {},
): HotspotSystemCounts {
  return {
    systemId,
    friendlyLosses: 0,
    enemyLosses: 0,
    cartelActivity: 0,
    ...overrides,
  };
}

describe("heatCount", () => {
  it("selects the count matching the active layer", () => {
    const row = { friendlyLosses: 1, enemyLosses: 2, cartelActivity: 3 };
    expect(heatCount(row, "friendly")).toBe(1);
    expect(heatCount(row, "enemy")).toBe(2);
    expect(heatCount(row, "cartel")).toBe(3);
    expect(heatCount(row, "off")).toBe(0);
  });
});

describe("heatBg", () => {
  const BASE: [number, number, number] = [24, 24, 27];

  it("returns undefined for zero activity", () => {
    expect(heatBg(BASE, 0, 10, "friendly")).toBeUndefined();
  });

  it("deepens toward the layer's colour as count approaches max", () => {
    const low = heatBg(BASE, 1, 10, "enemy");
    const high = heatBg(BASE, 9, 10, "enemy");
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(low).not.toBe(high);
  });

  it("uses a different hue per layer", () => {
    expect(heatBg(BASE, 5, 10, "friendly")).not.toBe(
      heatBg(BASE, 5, 10, "enemy"),
    );
    expect(heatBg(BASE, 5, 10, "enemy")).not.toBe(
      heatBg(BASE, 5, 10, "cartel"),
    );
  });

  it("blends from the given base colour, not a fixed default", () => {
    const fromDark = heatBg([0, 0, 0], 10, 10, "friendly");
    const fromLight = heatBg([255, 255, 255], 10, 10, "friendly");
    expect(fromDark).not.toBe(fromLight);
  });
});

describe("rankHotspots", () => {
  it("ranks by total activity across all three buckets, descending", () => {
    const systems = [node(1, "Quiet"), node(2, "Busy")];
    const data = [
      counts(1, { friendlyLosses: 1 }),
      counts(2, { friendlyLosses: 3, enemyLosses: 2, cartelActivity: 1 }),
    ];
    const rows = rankHotspots(systems, data, {});
    expect(rows.map((r) => r.systemName)).toEqual(["Busy", "Quiet"]);
  });

  it("drops counts for systems outside the given warzone system set", () => {
    const systems = [node(1, "InWarzone")];
    const data = [
      counts(1, { friendlyLosses: 1 }),
      counts(99, { friendlyLosses: 100 }),
    ];
    const rows = rankHotspots(systems, data, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].systemId).toBe(1);
  });

  it("breaks ties toward the closer system", () => {
    const systems = [node(1, "Far"), node(2, "Near")];
    const data = [
      counts(1, { friendlyLosses: 1 }),
      counts(2, { friendlyLosses: 1 }),
    ];
    const dist = { "1": 5, "2": 1 };
    const rows = rankHotspots(systems, data, dist);
    expect(rows.map((r) => r.systemName)).toEqual(["Near", "Far"]);
  });

  it("limits to the requested count", () => {
    const systems = Array.from({ length: 12 }, (_, i) =>
      node(i + 1, `Sys${i + 1}`),
    );
    const data = systems.map((s) => counts(s.systemId, { friendlyLosses: 1 }));
    expect(rankHotspots(systems, data, {}, 8)).toHaveLength(8);
  });

  it("carries hop distance through when known, null otherwise", () => {
    const systems = [node(1, "A"), node(2, "B")];
    const data = [
      counts(1, { friendlyLosses: 1 }),
      counts(2, { friendlyLosses: 1 }),
    ];
    const rows = rankHotspots(systems, data, { "1": 3 });
    const byId = new Map(rows.map((r) => [r.systemId, r]));
    expect(byId.get(1)!.hops).toBe(3);
    expect(byId.get(2)!.hops).toBeNull();
  });
});
