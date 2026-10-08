import {
  commands,
  type Decryptor,
  type ImplantBonus,
  type InventionBreakdown,
  type MaterialLine,
  type PriceBasis,
  type ProfitBreakdown,
  type ProfitParams,
  type RigTypeInfo,
  type SecurityTier,
} from "./generated/production";
import { unwrapCommand } from "./common";

export type {
  Decryptor,
  ImplantBonus,
  InventionBreakdown,
  MaterialLine,
  PriceBasis,
  ProfitBreakdown,
  ProfitParams,
  RigTypeInfo,
  SecurityTier,
};

/** Rank every manufacturable item by build-vs-buy profit at the chosen market. */
export async function productionProfit(
  params: ProfitParams,
): Promise<ProfitBreakdown[]> {
  return unwrapCommand(await commands.productionProfit(params));
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

/** All known manufacturing rig types with their bonuses (for the Facilities
 *  tab's rig selector). */
export async function productionManufacturingRigs(): Promise<RigTypeInfo[]> {
  return unwrapCommand(await commands.productionManufacturingRigs());
}

/** All known processing (reaction) rig types with their bonus descriptions. */
export async function productionProcessingRigs(): Promise<RigTypeInfo[]> {
  return unwrapCommand(await commands.productionProcessingRigs());
}

/** Compute rig bonuses from a set of selected rig type IDs + security tier.
 *  Returns `[meBonus, teBonusPct, costBonusPct]`. */
export async function productionRigBonuses(
  rigTypeIds: number[],
  securityTier: SecurityTier,
): Promise<[number, number, number]> {
  return unwrapCommand(
    await commands.productionRigBonuses({ rigTypeIds, securityTier }),
  );
}
