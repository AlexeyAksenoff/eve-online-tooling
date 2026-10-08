import type { OwnedBlueprint, PriceBasis, ProfitParams, ImplantBonus } from "../../lib/api";
import { type ImportedBlueprint, type FacilityProfiles } from "./types";

/**
 * Best researched ME/TE per blueprint type: the highest across owned copies,
 * then imported (unowned, modeled) entries layered on top — so a manually
 * imported ME/TE can raise the ceiling for a blueprint the roster doesn't
 * physically own, but never lowers what's actually researched. `ownedField`/
 * `importedField` pick the relevant column so the same reducer serves both
 * the ME map and the TE map.
 */
export function bestResearchedMap(
  owned: OwnedBlueprint[],
  imported: ImportedBlueprint[],
  ownedField: "materialEfficiency" | "timeEfficiency",
  importedField: "me" | "te",
): Record<number, number> {
  const map: Record<number, number> = {};
  for (const b of owned)
    map[b.typeId] = Math.max(map[b.typeId] ?? 0, b[ownedField]);
  for (const b of imported)
    map[b.typeId] = Math.max(map[b.typeId] ?? 0, b[importedField]);
  return map;
}

/**
 * Invention cost amortized per produced unit: the total per-attempt cost
 * (datacores + invention job fee + copy fee, already summed into
 * `attemptCost`) divided by the expected units an attempt yields
 * (`probability × runsPerSuccess`). Mirrors the pricing engine's own
 * per-unit invention EV (`src-tauri/src/modules/production/engine.rs`).
 * Zero expected yield (an impossible probability or run count) amortizes to
 * `0` rather than dividing by zero.
 */
export function inventionCostPerUnit(
  attemptCost: number,
  probability: number,
  runsPerSuccess: number,
): number {
  const yielded = probability * runsPerSuccess;
  return yielded > 0 ? attemptCost / yielded : 0;
}

/** Owned stock only nets against the bill of materials when "use stock" is on. */
export function resolveStock(
  useStock: boolean,
  stock: Record<number, number> | undefined,
): Record<number, number> {
  return useStock ? (stock ?? {}) : {};
}

/**
 * Count settings keys that differ between the current pricing inputs and the
 * snapshot taken as of the last Calculate — how many pricing-relevant
 * parameters have gone stale since the table was last priced.
 */
export function countDirtySettings<T extends Record<string, unknown>>(
  current: T,
  lastCalculated: T,
): number {
  return (Object.keys(current) as (keyof T)[]).filter(
    (k) => current[k] !== lastCalculated[k],
  ).length;
}

/** Everything `composeProfitParams` needs to build one pricing request. */
export interface ComposeProfitParamsInput {
  regionId: number;
  stationId: number | null;
  runs: number;
  me: number;
  useOwnedMe: boolean;
  ownedMe: Record<number, number>;
  te: number;
  ownedTe: Record<number, number>;
  timeSkill: number;
  useStock: boolean;
  stock: Record<number, number> | undefined;
  buildComponents: boolean;
  includeSaleCost: boolean;
  sellTaxPct: number;
  sellBrokerPct: number;
  materialBasis: PriceBasis;
  productBasis: PriceBasis;
  blueprintCostPerRun: number;
  inventionSkill: number;
  decryptorTypeId: number | null;
  productBestHub: boolean;
    facilityProfiles: FacilityProfiles;
  ignoreSideProducts: boolean;
  /** Character implant/facility module bonuses (time, ME, cost). */
  implant: ImplantBonus | null;
}

/**
 * Compose one `production_profit` request from the workbench's raw pricing
 * inputs: overlays owned/imported ME-TE onto the manual fallback (only when
 * "use owned ME/TE" is on), folds structure + rig bonuses into the engine's
 * multipliers, nets stock only when enabled, and converts every percentage
 * input (cost index, facility tax, sales tax, broker fee) to a fraction.
 */
export function composeProfitParams(
  input: ComposeProfitParamsInput,
): ProfitParams {
  return {
    regionId: input.regionId,
    stationId: input.stationId,
    runs: input.runs,
        me: input.me,
    // ownedMe/ownedTe are always sent for sub-component ME/TE resolution,
    // regardless of useOwnedMe (which only gates the top-level product).
    ownedMe: input.ownedMe,
    te: input.te,
    ownedTe: input.ownedTe,
    timeSkill: input.timeSkill,
    stock: resolveStock(input.useStock, input.stock),
    buildComponents: input.buildComponents,
    includeSalesCost: input.includeSaleCost,
    salesTax: input.sellTaxPct / 100,
    brokerFee: input.sellBrokerPct / 100,
    materialBasis: input.materialBasis,
    productBasis: input.productBasis,
    blueprintCostPerRun: input.blueprintCostPerRun,
    inventionSkillLevel: input.inventionSkill,
    decryptorTypeId: input.decryptorTypeId,
    productBestHub: input.productBestHub,
        facilityProfiles: input.facilityProfiles,
    ignoreSideProducts: input.ignoreSideProducts,
    implant: input.implant,
  };
}
