import { describe, expect, it } from "vitest";
import { etaHours, trendTier, trendTooltip } from "./vpTrend";

describe("trendTier", () => {
  it("is null with no velocity yet", () => {
    expect(trendTier(null)).toBeNull();
  });

  it("classifies fast gains, gains, stable, and falling", () => {
    expect(trendTier(0.15)).toBe("fast-up"); // 15%/h ≥ 10%/h threshold
    expect(trendTier(0.1)).toBe("fast-up"); // boundary inclusive
    expect(trendTier(0.05)).toBe("up");
    expect(trendTier(0.02)).toBe("stable"); // boundary inclusive
    expect(trendTier(0)).toBe("stable");
    expect(trendTier(-0.02)).toBe("stable"); // boundary inclusive
    expect(trendTier(-0.05)).toBe("down");
  });
});

describe("etaHours", () => {
  it("is null with no velocity", () => {
    expect(etaHours(0.5, null)).toBeNull();
  });

  it("is null when falling or flat — no meaningful ETA to flip", () => {
    expect(etaHours(0.5, 0)).toBeNull();
    expect(etaHours(0.5, -0.1)).toBeNull();
  });

  it("computes hours remaining to full capture at the current rate", () => {
    // 50% remaining at 25%/hour → 2 hours.
    expect(etaHours(0.5, 0.25)).toBeCloseTo(2);
    // Already captured → 0 hours remaining.
    expect(etaHours(1, 0.1)).toBeCloseTo(0);
  });
});

describe("trendTooltip", () => {
  it("reports no history when velocity is null", () => {
    expect(trendTooltip(0.5, null)).toBe("Not enough history yet");
  });

  it("shows the signed rate and ETA when climbing", () => {
    expect(trendTooltip(0.5, 0.25)).toBe("+25.0%/h · ≈2.0h to flip");
  });

  it("shows just the signed rate when falling (no ETA)", () => {
    expect(trendTooltip(0.5, -0.1)).toBe("-10.0%/h");
  });
});
