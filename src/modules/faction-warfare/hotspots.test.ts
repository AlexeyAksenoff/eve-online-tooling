import { describe, expect, it } from "vitest";
import {
  heatBg,
  heatCount,
  hotspotDescription,
  hotspotTotal,
} from "./hotspots";

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
