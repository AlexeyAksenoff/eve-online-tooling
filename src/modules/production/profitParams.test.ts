import { describe, expect, it } from "vitest";
import type { OwnedBlueprint } from "../../lib/api";
import type { ImportedBlueprint } from "./types";
import {
  bestResearchedMap,
  composeProfitParams,
  countDirtySettings,
  inventionCostPerUnit,
  resolveStock,
  type ComposeProfitParamsInput,
} from "./profitParams";
import { defaultFacilityProfiles } from "./facilityProfiles";

function ownedBp(typeId: number, me: number, te: number): OwnedBlueprint {
  return {
    characterId: 1,
    characterName: "Pilot",
    corporation: false,
    typeId,
    name: "Blueprint",
    materialEfficiency: me,
    timeEfficiency: te,
    runs: -1,
    quantity: 1,
  } as OwnedBlueprint;
}

function importedBp(typeId: number, me: number, te: number): ImportedBlueprint {
  return { typeId, name: "Imported Blueprint", me, te };
}

function baseInput(
  overrides: Partial<ComposeProfitParamsInput> = {},
): ComposeProfitParamsInput {
  return {
    regionId: 10000002,
    stationId: null,
    runs: 1,
    me: 0,
    useOwnedMe: false,
    ownedMe: {},
    te: 0,
    ownedTe: {},
    componentMe: 0,
    componentTe: 0,
    timeSkill: 5,
    useStock: false,
    stock: undefined,
    buildComponents: false,
    includeSaleCost: false,
    sellTaxPct: 4.5,
    sellBrokerPct: 3,
    materialBasis: "sellPercentile",
    productBasis: "sellPercentile",
    blueprintCostPerRun: 0,
    inventionSkill: 5,
    decryptorTypeId: null,
    productBestHub: false,
    facilityProfiles: defaultFacilityProfiles(),
    ignoreSideProducts: true,
    implant: null,
    ...overrides,
  };
}

describe("bestResearchedMap", () => {
  it("takes the max ME across owned copies of the same blueprint", () => {
    const map = bestResearchedMap(
      [ownedBp(1, 5, 10), ownedBp(1, 10, 4)],
      [],
      "materialEfficiency",
      "me",
    );
    expect(map).toEqual({ 1: 10 });
  });

  it("layers an imported entry on top without lowering an owned value", () => {
    const map = bestResearchedMap(
      [ownedBp(1, 10, 0)],
      [importedBp(1, 4, 0)],
      "materialEfficiency",
      "me",
    );
    expect(map[1]).toBe(10);
  });

  it("lets an imported entry raise the ceiling for a blueprint that isn't owned", () => {
    const map = bestResearchedMap(
      [],
      [importedBp(2, 8, 0)],
      "materialEfficiency",
      "me",
    );
    expect(map[2]).toBe(8);
  });
});

describe("inventionCostPerUnit", () => {
  it("amortizes attempt cost over expected yield (probability × runs)", () => {
    // 100k per attempt, 25% chance, 10 runs/success -> expected yield 2.5 units.
    expect(inventionCostPerUnit(100_000, 0.25, 10)).toBeCloseTo(40_000, 6);
  });

  it("returns 0 when expected yield is zero instead of dividing by zero", () => {
    expect(inventionCostPerUnit(100_000, 0, 10)).toBe(0);
    expect(inventionCostPerUnit(100_000, 0.5, 0)).toBe(0);
  });
});

describe("resolveStock", () => {
  it("returns an empty map when stock usage is off, even if stock data exists", () => {
    expect(resolveStock(false, { 1: 50 })).toEqual({});
  });

  it("returns the stock map when enabled", () => {
    expect(resolveStock(true, { 1: 50 })).toEqual({ 1: 50 });
  });

  it("falls back to an empty map when enabled but stock hasn't loaded yet", () => {
    expect(resolveStock(true, undefined)).toEqual({});
  });
});

describe("countDirtySettings", () => {
  it("returns 0 when nothing changed", () => {
    const s = { a: 1, b: "x" };
    expect(countDirtySettings(s, { ...s })).toBe(0);
  });

  it("counts exactly the keys that differ", () => {
    const current = { regionId: 1, runs: 2, me: 3 };
    const last = { regionId: 1, runs: 9, me: 9 };
    expect(countDirtySettings(current, last)).toBe(2);
  });

  it("flags every pricing-relevant param individually", () => {
    const current = {
      regionId: 10000002,
      runs: 1,
      me: 0,
      useStock: false,
      structure: "npc",
    };
    for (const key of Object.keys(current) as (keyof typeof current)[]) {
      const last = { ...current, [key]: "definitely-different" };
      expect(countDirtySettings(current, last)).toBe(1);
    }
  });
});

describe("composeProfitParams", () => {
  it("uses owned ME/TE overrides instead of the manual value when enabled", () => {
    const params = composeProfitParams(
      baseInput({
        me: 5,
        te: 8,
        useOwnedMe: true,
        ownedMe: { 10: 10 },
        ownedTe: { 10: 20 },
      }),
    );
    expect(params.me).toBe(5); // manual value still passed as the fallback
    expect(params.ownedMe).toEqual({ 10: 10 }); // engine prefers this for owned BPs
    expect(params.ownedTe).toEqual({ 10: 20 });
  });

  it("always passes ownedMe/ownedTe for sub-component ME resolution (regardless of useOwnedMe)", () => {
    const params = composeProfitParams(
      baseInput({
        useOwnedMe: false,
        ownedMe: { 10: 10 },
        ownedTe: { 10: 20 },
      }),
    );
    // ownedMe/ownedTe are always passed through — the Rust engine uses them
    // for per-component ME/TE in build_unit_cost() regardless of useOwnedMe.
    expect(params.ownedMe).toEqual({ 10: 10 });
    expect(params.ownedTe).toEqual({ 10: 20 });
  });

  it("nets stock only when useStock is on", () => {
    const withStock = composeProfitParams(
      baseInput({ useStock: true, stock: { 5: 3 } }),
    );
    expect(withStock.stock).toEqual({ 5: 3 });

    const withoutStock = composeProfitParams(
      baseInput({ useStock: false, stock: { 5: 3 } }),
    );
    expect(withoutStock.stock).toEqual({});
  });

  it("converts percentage inputs (sales tax, broker fee) to fractions", () => {
    const params = composeProfitParams(
      baseInput({
        includeSaleCost: true,
        sellTaxPct: 4.5,
        sellBrokerPct: 3,
      }),
    );
    expect(params.salesTax).toBeCloseTo(0.045, 10);
    expect(params.brokerFee).toBeCloseTo(0.03, 10);
  });

  it("passes facilityProfiles through to ProfitParams", () => {
    const profiles = defaultFacilityProfiles();
    const params = composeProfitParams(
      baseInput({ facilityProfiles: profiles }),
    );
    expect(params.facilityProfiles).toBe(profiles);
  });

  it("passes ignoreSideProducts through to ProfitParams", () => {
    const params = composeProfitParams(
      baseInput({ ignoreSideProducts: false }),
    );
    expect(params.ignoreSideProducts).toBe(false);
  });

  it("passes implant through to ProfitParams", () => {
    const params = composeProfitParams(
      baseInput({
        implant: { timeBonusPct: 4, materialBonus: 1.0, costBonusPct: 0 },
      }),
    );
    expect(params.implant).toEqual({
      timeBonusPct: 4,
      materialBonus: 1.0,
      costBonusPct: 0,
    });
  });
});
