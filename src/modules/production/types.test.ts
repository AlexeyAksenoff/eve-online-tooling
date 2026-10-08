import { describe, expect, it } from "vitest";

import {
  SECURITY_TIERS,
  WORMHOLE_REGION_ID_START,
  securityToTier,
} from "./types";

describe("securityToTier", () => {
  it("classifies highsec for security >= 0.5", () => {
    expect(securityToTier(0.5)).toBe("highsec");
    expect(securityToTier(1.0)).toBe("highsec");
  });

  it("classifies lowsec for 0 < security < 0.5", () => {
    expect(securityToTier(0.1)).toBe("lowsec");
    expect(securityToTier(0.49)).toBe("lowsec");
  });

  it("classifies nullsec for security <= 0", () => {
    expect(securityToTier(0.0)).toBe("nullsec");
    expect(securityToTier(-1.0)).toBe("nullsec");
  });

  it("detects wormhole via regionId regardless of the security float", () => {
    expect(securityToTier(0.0, WORMHOLE_REGION_ID_START)).toBe("wormhole");
    expect(securityToTier(0.5, WORMHOLE_REGION_ID_START + 100)).toBe(
      "wormhole",
    );
  });

  it("falls back to highsec for null security when no region is selected", () => {
    // null security (no station selected yet) + no WH region → highsec fallback
    expect(securityToTier(-0.1, null)).toBe("nullsec");
  });

  it("SECURITY_TIERS has the wormhole no-cost-index flag", () => {
    expect(SECURITY_TIERS.wormhole.hasNoLiveCostIndex).toBe(true);
    expect(SECURITY_TIERS.highsec.hasNoLiveCostIndex).toBe(false);
  });
});
