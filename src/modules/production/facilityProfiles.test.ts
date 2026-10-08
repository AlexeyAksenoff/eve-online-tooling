import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  composeFacilityProfile,
  defaultFacilityProfiles,
  exportFacilityProfiles,
  importFacilityProfiles,
  isApproximate,
  facilityProfileLabel,
} from "./facilityProfiles";

const store: Record<string, string> = {};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        for (const k of Object.keys(store)) delete store[k];
      }),
    },
    writable: true,
  });
});

describe("composeFacilityProfile", () => {
  it("composes Raitaru manufacturing profile with rig type IDs", () => {
    const p = composeFacilityProfile(
      "manufacturing",
      "raitaru",
      "highsec",
      [1957], // Medium Manufacturing Material Rig I
      0.05,
      0.0,
    );
    // Structure base ME (0.99), te (15%), cost (0.03) — rigs applied separately.
    expect(p.meBonus).toBe(0.99);
    expect(p.teBonusPct).toBe(15);
    expect(p.costBonus).toBe(0.03);
    expect(p.roleBonusTime).toBe(0);
    expect(p.rigTypeIds).toEqual([1957]);
    expect(p.systemCostIndex).toBe(0.05);
    expect(p.taxRate).toBe(0.0);
  });

  it("Tatara reaction profile has 0.25 role_bonus_time", () => {
    const p = composeFacilityProfile(
      "reaction",
      "tatara",
      "nullsec",
      [],
      0.08,
      0.1,
    );
    expect(p.roleBonusTime).toBe(0.25);
    expect(p.teBonusPct).toBe(0);
    expect(p.rigTypeIds).toEqual([]);
  });

  it("returns approximate=true when systemCostIndex is null", () => {
    const p = composeFacilityProfile(
      "reaction",
      "tatara",
      "wormhole",
      [],
      null,
      null,
    );
    expect(p.systemCostIndex).toBe(null);
    expect(p.taxRate).toBe(null);
  });
});

describe("defaultFacilityProfiles", () => {
  it("returns NPC station profiles with no overrides", () => {
    const profiles = defaultFacilityProfiles();
    expect(profiles.manufacturing.structure).toBe("npcStation");
    expect(profiles.reaction.structure).toBe("npcStation");
    expect(profiles.manufacturing.meBonus).toBe(1.0);
    expect(profiles.manufacturing.systemCostIndex).toBe(null);
  });
});

describe("isApproximate", () => {
  it("returns false when both profiles have cost index and tax", () => {
    const profiles = defaultFacilityProfiles();
    const ok = {
      ...profiles,
      manufacturing: {
        ...profiles.manufacturing,
        systemCostIndex: 0.05,
        taxRate: 0,
      },
      reaction: {
        ...profiles.reaction,
        systemCostIndex: 0.08,
        taxRate: 0.05,
      },
    };
    expect(isApproximate(ok)).toBe(false);
  });
});

describe("facilityProfileLabel", () => {
  it("labels a Tatara reaction profile", () => {
    const p = composeFacilityProfile(
      "reaction",
      "tatara",
      "nullsec",
      [],
      null,
      null,
    );
    expect(facilityProfileLabel(p)).toBe("Tatara, Nullsec");
  });

  it("includes rig count in label when rigs are selected", () => {
    const p = composeFacilityProfile(
      "manufacturing",
      "raitaru",
      "highsec",
      [1957, 1955],
      0.05,
      0.0,
    );
    expect(facilityProfileLabel(p)).toContain("Raitaru, Highsec (2 rigs)");
  });
});

describe("JSON export/import round-trip", () => {
  it("exports and re-imports a profile pair", () => {
    const original = defaultFacilityProfiles();
    const json = exportFacilityProfiles(original);
    const restored = importFacilityProfiles(json);
    expect(restored.manufacturing.structure).toBe(
      original.manufacturing.structure,
    );
    expect(restored.reaction.structure).toBe(original.reaction.structure);
    expect(restored.manufacturing.meBonus).toBeCloseTo(
      original.manufacturing.meBonus,
      10,
    );
  });

  it("falls back to defaults on invalid JSON", () => {
    const restored = importFacilityProfiles("not valid json {{{");
    expect(restored.manufacturing.structure).toBe("npcStation");
    expect(restored.reaction.structure).toBe("npcStation");
  });
});
