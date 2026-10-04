import { describe, expect, it } from "vitest";
import type { FwSystemNode } from "../../lib/api";
import {
  factionSignedDelta,
  formatVpDeltaPct,
  loginDelta,
  updateLoginBaselines,
  type VpLoginBaseline,
} from "./vpChange";

const MINMATAR = 500002;
const AMARR = 500003;

function node(overrides: Partial<FwSystemNode> = {}): FwSystemNode {
  return {
    systemId: 1,
    name: "Sys1",
    region: "Region",
    warzone: "Amarr–Minmatar",
    security: 0.3,
    owner: "Amarr Empire",
    occupier: "Amarr Empire",
    ownerId: AMARR,
    occupierId: AMARR,
    contested: "contested",
    vpPct: 0.4,
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

describe("factionSignedDelta", () => {
  it("is null with no raw delta yet", () => {
    expect(factionSignedDelta(null, AMARR, MINMATAR)).toBeNull();
  });

  it("flips the sign when the enemy is occupying (their gain is my loss)", () => {
    // Amarr (enemy) gained 0.4 → bad for Minmatar → -0.4.
    expect(factionSignedDelta(0.4, AMARR, MINMATAR)).toBeCloseTo(-0.4);
    // Amarr (enemy) lost 0.2 (their vp fell) → good for Minmatar → +0.2.
    expect(factionSignedDelta(-0.2, AMARR, MINMATAR)).toBeCloseTo(0.2);
  });

  it("keeps the sign when my own militia is occupying (my gain is my gain)", () => {
    expect(factionSignedDelta(0.3, MINMATAR, MINMATAR)).toBeCloseTo(0.3);
    expect(factionSignedDelta(-0.1, MINMATAR, MINMATAR)).toBeCloseTo(-0.1);
  });

  it("is null when the occupier is neither mine nor my enemy", () => {
    const CALDARI = 500001;
    expect(factionSignedDelta(0.2, CALDARI, MINMATAR)).toBeNull();
  });
});

describe("updateLoginBaselines / loginDelta", () => {
  it("anchors a system's baseline the first time it's seen", () => {
    const baseline = updateLoginBaselines(new Map(), [
      node({ systemId: 1, occupierId: AMARR, vpPct: 0.2 }),
    ]);
    expect(loginDelta(baseline, 1, 0.2)).toBeCloseTo(0);
    expect(loginDelta(baseline, 1, 0.5)).toBeCloseTo(0.3);
  });

  it("is null for a system with no baseline yet", () => {
    expect(loginDelta(new Map(), 1, 0.5)).toBeNull();
  });

  it("keeps the original baseline across repeated polls of the same occupier", () => {
    let baseline = updateLoginBaselines(new Map(), [
      node({ systemId: 1, occupierId: AMARR, vpPct: 0.1 }),
    ]);
    baseline = updateLoginBaselines(baseline, [
      node({ systemId: 1, occupierId: AMARR, vpPct: 0.6 }),
    ]);
    // Still anchored at the original 0.1, not re-anchored to 0.6.
    expect(loginDelta(baseline, 1, 0.6)).toBeCloseTo(0.5);
  });

  it("re-anchors on an ownership flip instead of reporting a wild spike", () => {
    let baseline = updateLoginBaselines(new Map(), [
      node({ systemId: 1, occupierId: AMARR, vpPct: 0.9 }),
    ]);
    baseline = updateLoginBaselines(baseline, [
      node({ systemId: 1, occupierId: MINMATAR, vpPct: 0.02 }),
    ]);
    expect(loginDelta(baseline, 1, 0.02)).toBeCloseTo(0);
  });

  it("leaves other systems' baselines untouched", () => {
    const seed: Map<number, VpLoginBaseline> = new Map([
      [2, { occupierId: AMARR, vpPct: 0.3 }],
    ]);
    const next = updateLoginBaselines(seed, [
      node({ systemId: 1, occupierId: AMARR, vpPct: 0.1 }),
    ]);
    expect(next.get(2)).toEqual({ occupierId: AMARR, vpPct: 0.3 });
  });
});

describe("formatVpDeltaPct", () => {
  it("shows an em-dash with no value", () => {
    expect(formatVpDeltaPct(null)).toBe("—");
  });

  it("signs gains and losses", () => {
    expect(formatVpDeltaPct(0.042)).toBe("+4.2%");
    expect(formatVpDeltaPct(-0.018)).toBe("-1.8%");
  });

  it("reads as flat under the noise threshold", () => {
    expect(formatVpDeltaPct(0.0001)).toBe("0.0%");
    expect(formatVpDeltaPct(-0.0001)).toBe("0.0%");
  });
});
