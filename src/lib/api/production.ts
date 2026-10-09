import {
  commands,
  type BlueprintSearchResult,
  type Decryptor,
  type ImplantBonus,
  type InventionBreakdown,
  type MaterialLine,
  type PriceBasis,
  type ProfitBreakdown,
  type ProfitParams,
  type ReactionLine,
  type ReactionPlan,
  type FacilityType,
  type RigTypeInfo,
  type SecurityTier,
} from "./generated/production";
import { unwrapCommand } from "./common";

export type {
  BlueprintSearchResult,
  Decryptor,
  ImplantBonus,
  InventionBreakdown,
  MaterialLine,
  PriceBasis,
  ProfitBreakdown,
  ProfitParams,
  ReactionLine,
  ReactionPlan,
  RigTypeInfo,
  SecurityTier,
};

/** Rank every manufacturable item by build-vs-buy profit at the chosen market. */
export async function productionProfit(
  params: ProfitParams,
): Promise<ProfitBreakdown[]> {
  return unwrapCommand(await commands.productionProfit(params));
}

/** Price a single blueprint and return its full build-vs-buy breakdown.
 *  Used by the Build Planner to avoid pricing the entire catalogue. */
export async function productionProfitForBlueprint(
  blueprintTypeId: number,
  params: ProfitParams,
): Promise<ProfitBreakdown> {
  return unwrapCommand(
    await commands.productionProfitForBlueprint(blueprintTypeId, params),
  );
}

/** Search manufacturable blueprints by product name (case-insensitive,
 *  multi-term AND). Returns short results for the Build Planner picker. */
export async function productionSearchBlueprints(
  query: string,
  limit: number,
): Promise<BlueprintSearchResult[]> {
  return unwrapCommand(await commands.productionSearchBlueprints(query, limit));
}

/** The invention decryptors, for the production decryptor dropdown. */
export async function productionDecryptors(): Promise<Decryptor[]> {
  return unwrapCommand(await commands.productionDecryptors());
}

/** The live manufacturing cost index for a solar system (ESI /industry/systems/,
 *  cached ~1h). `null` when the system isn't listed (e.g. wormhole space). */
export async function productionSystemCostIndex(
  systemId: number,
): Promise<number | null> {
  return unwrapCommand(await commands.productionSystemCostIndex(systemId));
}

/** The raw SDE system security (−1.0…+1.0) for the station's solar system, so
 *  the UI can auto-derive the security tier (Highsec/Lowsec/Nullsec/WH) instead
 *  of trusting a hand-picked dropdown. `null` for Upwell structures (which
 *  aren't in `staStations`) — the caller then falls back to region-based WH
 *  detection. */
export async function productionStationSecurity(
  stationId: number,
): Promise<number | null> {
  return unwrapCommand(await commands.productionStationSecurity(stationId));
}

/** All industry rigs for one facility type, filtered to those whose slot size
 *  exactly matches `maxRigSize` (the size of the slot the chosen structure
 *  provides). `facilityType` selects refinery/reactor rigs (Reactions) vs.
 *  engineering rigs (Manufacturing/Components). */
export async function productionRigs(
  facilityType: FacilityType,
  maxRigSize: number,
): Promise<RigTypeInfo[]> {
  return unwrapCommand(await commands.productionRigs(facilityType, maxRigSize));
}

/** Compute security-scaled rig bonuses for the selected type IDs + facility
 *  security tier. Returns `[meBonus, teBonusPct, costBonusPct]`. Legacy rigs
 *  (1955-1978) use the built-in table; Standup rigs (M/L/XL-Set) are read
 *  from the SDE and scaled by the rig's own security modifiers. */
export async function productionRigBonuses(
  rigTypeIds: number[],
  securityTier: SecurityTier,
): Promise<[number, number, number]> {
  return unwrapCommand(
    await commands.productionRigBonuses(rigTypeIds, securityTier),
  );
}
