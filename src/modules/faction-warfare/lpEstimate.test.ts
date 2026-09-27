import { describe, expect, it } from "vitest";
import {
  BATTLEFIELD_LP_MULTIPLIER,
  MILITIA_LP_CORP_ID,
  plexingIskPerHour,
} from "./lpEstimate";

describe("plexingIskPerHour", () => {
  it("scales with the battlefield multiplier", () => {
    const front = plexingIskPerHour("frontline", 1000);
    const ops = plexingIskPerHour("commandops", 1000);
    const rear = plexingIskPerHour("rearguard", 1000);
    expect(front).toBeGreaterThan(ops);
    expect(ops).toBeGreaterThan(rear);
    expect(front / ops).toBeCloseTo(1.5, 5);
    expect(ops / rear).toBeCloseTo(100, 5);
  });

  it("scales linearly with the conversion rate", () => {
    const at1 = plexingIskPerHour("frontline", 1);
    const at10 = plexingIskPerHour("frontline", 10);
    expect(at10).toBeCloseTo(at1 * 10, 5);
  });

  it("returns 0 for an unrecognised battlefield class", () => {
    expect(plexingIskPerHour("unknown", 1000)).toBe(0);
  });

  it("has an entry for every militia faction id", () => {
    expect(Object.keys(MILITIA_LP_CORP_ID)).toHaveLength(4);
    expect(new Set(Object.values(MILITIA_LP_CORP_ID)).size).toBe(4);
  });

  it("has the documented battlefield multipliers", () => {
    expect(BATTLEFIELD_LP_MULTIPLIER.frontline).toBe(1.5);
    expect(BATTLEFIELD_LP_MULTIPLIER.commandops).toBe(1.0);
    expect(BATTLEFIELD_LP_MULTIPLIER.rearguard).toBe(0.01);
  });
});
