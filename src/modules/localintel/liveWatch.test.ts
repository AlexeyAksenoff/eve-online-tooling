import { describe, expect, it } from "vitest";
import {
  killEventEntityIds,
  matchesScannedSystem,
  matchesWatchlist,
  shouldNotifyLiveWatch,
} from "./liveWatch";
import type { KillEvent } from "../../lib/api";

function event(overrides: Partial<KillEvent> = {}): KillEvent {
  return {
    killmailId: 1,
    solarSystemId: 30002813,
    timeSecs: 0,
    victimFactionId: null,
    attackerFactionIds: [],
    victimCorporationId: null,
    victimAllianceId: null,
    attackerCorporationIds: [],
    attackerAllianceIds: [],
    ...overrides,
  };
}

describe("killEventEntityIds", () => {
  it("collects victim corp/alliance and every attacker corp/alliance", () => {
    const e = event({
      victimCorporationId: 1,
      victimAllianceId: 2,
      attackerCorporationIds: [3, 4],
      attackerAllianceIds: [5],
    });
    expect(killEventEntityIds(e).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("omits null victim ids rather than including them", () => {
    const e = event({ attackerCorporationIds: [3] });
    expect(killEventEntityIds(e)).toEqual([3]);
  });
});

describe("matchesWatchlist", () => {
  it("matches when the victim's corp is watched", () => {
    const e = event({ victimCorporationId: 98_000_001 });
    expect(matchesWatchlist(e, new Set([98_000_001]))).toBe(true);
  });

  it("matches when any attacker's alliance is watched", () => {
    const e = event({ attackerAllianceIds: [99_000_002] });
    expect(matchesWatchlist(e, new Set([99_000_002]))).toBe(true);
  });

  it("does not match an unrelated event", () => {
    const e = event({ victimCorporationId: 1, attackerCorporationIds: [2] });
    expect(matchesWatchlist(e, new Set([999]))).toBe(false);
  });

  it("does not match against an empty watchlist", () => {
    const e = event({ victimCorporationId: 1 });
    expect(matchesWatchlist(e, new Set())).toBe(false);
  });
});

describe("shouldNotifyLiveWatch", () => {
  it("allows the first-ever notification", () => {
    expect(shouldNotifyLiveWatch(-Infinity, 0, 30_000)).toBe(true);
  });

  it("blocks a repeat notification inside the cooldown", () => {
    expect(shouldNotifyLiveWatch(10_000, 20_000, 30_000)).toBe(false);
  });

  it("allows a notification once the cooldown has elapsed", () => {
    expect(shouldNotifyLiveWatch(0, 30_000, 30_000)).toBe(true);
  });
});

describe("matchesScannedSystem", () => {
  it("matches when the event is in the scanned system", () => {
    const e = event({ solarSystemId: 30002813 });
    expect(matchesScannedSystem(e, 30002813)).toBe(true);
  });

  it("does not match a different system", () => {
    const e = event({ solarSystemId: 30002813 });
    expect(matchesScannedSystem(e, 30000142)).toBe(false);
  });

  it("does not match when nothing is scanned yet", () => {
    const e = event({ solarSystemId: 30002813 });
    expect(matchesScannedSystem(e, null)).toBe(false);
  });
});
