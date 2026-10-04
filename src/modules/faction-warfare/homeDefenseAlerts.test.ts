import { describe, expect, it } from "vitest";
import {
  detectHomeDefenseAlerts,
  shouldTriggerLiveRefetch,
  snapshotSystems,
  type HomeDefenseSettings,
} from "./homeDefenseAlerts";
import type { FwSystemNode } from "../../lib/api";

function node(
  id: number,
  contested: string,
  occupierId = 500003,
): FwSystemNode {
  return {
    systemId: id,
    name: `Sys${id}`,
    region: "Devoid",
    warzone: "Amarr–Minmatar",
    security: 0.3,
    owner: "Amarr",
    occupier: "Amarr",
    ownerId: occupierId,
    occupierId,
    contested,
    vpPct: 0.5,
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

const ALL_ON: HomeDefenseSettings = {
  vulnerableAlertOn: true,
  nearbyFlipRadius: "5",
};

describe("detectHomeDefenseAlerts", () => {
  it("fires no alerts on the first poll (no baseline to diff against)", () => {
    const curr = [node(1, "vulnerable", 500003)];
    expect(detectHomeDefenseAlerts(null, curr, 500003, {}, ALL_ON)).toEqual([]);
  });

  it("fires a vulnerable alert only on the contested -> vulnerable transition", () => {
    const before = snapshotSystems([node(1, "contested", 500003)]);
    const after = [node(1, "vulnerable", 500003)];
    const alerts = detectHomeDefenseAlerts(before, after, 500003, {}, ALL_ON);
    expect(alerts).toEqual([
      {
        kind: "vulnerable",
        systemId: 1,
        systemName: "Sys1",
        contested: "vulnerable",
      },
    ]);
  });

  it("does not re-alert while a system stays vulnerable across polls", () => {
    const prev = snapshotSystems([node(1, "vulnerable", 500003)]);
    const curr = [node(1, "vulnerable", 500003)];
    expect(detectHomeDefenseAlerts(prev, curr, 500003, {}, ALL_ON)).toEqual([]);
  });

  it("does not alert for an enemy system going vulnerable", () => {
    const prev = snapshotSystems([node(1, "contested", 500002)]);
    const curr = [node(1, "vulnerable", 500002)];
    expect(detectHomeDefenseAlerts(prev, curr, 500003, {}, ALL_ON)).toEqual([]);
  });

  it("respects the vulnerableAlertOn toggle", () => {
    const prev = snapshotSystems([node(1, "contested", 500003)]);
    const curr = [node(1, "vulnerable", 500003)];
    const settings: HomeDefenseSettings = {
      vulnerableAlertOn: false,
      nearbyFlipRadius: "5",
    };
    expect(detectHomeDefenseAlerts(prev, curr, 500003, {}, settings)).toEqual(
      [],
    );
  });

  it("fires a flip alert for any contested-state change within the radius", () => {
    const prev = snapshotSystems([node(2, "uncontested", 500002)]);
    const curr = [node(2, "contested", 500002)];
    const dist = { "2": 3 };
    const alerts = detectHomeDefenseAlerts(prev, curr, 500003, dist, ALL_ON);
    expect(alerts).toEqual([
      { kind: "flip", systemId: 2, systemName: "Sys2", contested: "contested" },
    ]);
  });

  it("does not fire a flip alert outside the configured radius", () => {
    const prev = snapshotSystems([node(2, "uncontested", 500002)]);
    const curr = [node(2, "contested", 500002)];
    const dist = { "2": 6 };
    expect(detectHomeDefenseAlerts(prev, curr, 500003, dist, ALL_ON)).toEqual(
      [],
    );
  });

  it("does not fire a flip alert for a system with no known distance", () => {
    const prev = snapshotSystems([node(2, "uncontested", 500002)]);
    const curr = [node(2, "contested", 500002)];
    expect(detectHomeDefenseAlerts(prev, curr, 500003, {}, ALL_ON)).toEqual([]);
  });

  it('disables the nearby-flip rule entirely when radius is "off"', () => {
    const prev = snapshotSystems([node(2, "uncontested", 500002)]);
    const curr = [node(2, "contested", 500002)];
    const dist = { "2": 1 };
    const settings: HomeDefenseSettings = {
      vulnerableAlertOn: true,
      nearbyFlipRadius: "off",
    };
    expect(detectHomeDefenseAlerts(prev, curr, 500003, dist, settings)).toEqual(
      [],
    );
  });

  it("can fire both alerts in the same poll for a friendly system flipping into vulnerable within radius", () => {
    const prev = snapshotSystems([node(1, "contested", 500003)]);
    const curr = [node(1, "vulnerable", 500003)];
    const dist = { "1": 0 };
    const alerts = detectHomeDefenseAlerts(prev, curr, 500003, dist, ALL_ON);
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.kind).sort()).toEqual(["flip", "vulnerable"]);
  });

  it("skips a system with no prior snapshot (newly appeared) rather than treating it as a transition", () => {
    const prev = snapshotSystems([node(1, "uncontested", 500003)]);
    const curr = [
      node(1, "uncontested", 500003),
      node(2, "vulnerable", 500003),
    ];
    expect(detectHomeDefenseAlerts(prev, curr, 500003, {}, ALL_ON)).toEqual([]);
  });
});

describe("shouldTriggerLiveRefetch", () => {
  const watched = new Set([1, 2, 3]);

  it("ignores a kill in a system outside the watched set", () => {
    expect(shouldTriggerLiveRefetch(99, watched, 0, 100_000, 30_000)).toBe(
      false,
    );
  });

  it("triggers for a watched system when the cooldown has elapsed", () => {
    expect(shouldTriggerLiveRefetch(1, watched, 0, 30_000, 30_000)).toBe(true);
  });

  it("does not re-trigger inside the cooldown window (a kill flurry)", () => {
    expect(shouldTriggerLiveRefetch(1, watched, 10_000, 20_000, 30_000)).toBe(
      false,
    );
  });

  it("always triggers the very first time (lastTriggeredAtMs = -Infinity)", () => {
    expect(shouldTriggerLiveRefetch(1, watched, -Infinity, 0, 30_000)).toBe(
      true,
    );
  });
});
