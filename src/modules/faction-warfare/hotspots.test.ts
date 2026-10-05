import { describe, expect, it } from "vitest";
import { hotspotDescription, hotspotHeatBg, hotspotTotal } from "./hotspots";

describe("hotspotHeatBg", () => {
  const BASE: [number, number, number] = [24, 24, 27];

  it("returns undefined for zero activity", () => {
    expect(hotspotHeatBg(BASE, 0, 10)).toBeUndefined();
  });

  it("deepens toward the heat colour as total approaches max", () => {
    const low = hotspotHeatBg(BASE, 1, 10);
    const high = hotspotHeatBg(BASE, 9, 10);
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(low).not.toBe(high);
  });

  it("blends from the given base colour, not a fixed default", () => {
    const fromDark = hotspotHeatBg([0, 0, 0], 10, 10);
    const fromLight = hotspotHeatBg([255, 255, 255], 10, 10);
    expect(fromDark).not.toBe(fromLight);
  });
});

describe("hotspotTotal", () => {
  it("sums all three buckets", () => {
    expect(
      hotspotTotal({ friendlyLosses: 2, enemyLosses: 3, cartelActivity: 1 }),
    ).toBe(6);
  });
});

describe("hotspotDescription", () => {
  it("omits zero terms and joins the rest", () => {
    expect(
      hotspotDescription({
        friendlyLosses: 3,
        enemyLosses: 0,
        cartelActivity: 1,
      }),
    ).toBe("3 ours · 1 cartel");
  });

  it("reads as a dash with no activity at all", () => {
    expect(
      hotspotDescription({
        friendlyLosses: 0,
        enemyLosses: 0,
        cartelActivity: 0,
      }),
    ).toBe("—");
  });

  it("shows all three when every bucket has activity", () => {
    expect(
      hotspotDescription({
        friendlyLosses: 1,
        enemyLosses: 2,
        cartelActivity: 3,
      }),
    ).toBe("1 ours · 2 theirs · 3 cartel");
  });
});
