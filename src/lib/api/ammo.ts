import { invoke } from "@tauri-apps/api/core";

/** A turret family — each has its own T1/Navy/T2 Small charges. */
export type AmmoFamily = "hybrid" | "projectile" | "laser";

/** A charge's rarity/tier within its family. */
export type AmmoTier = "T1" | "Navy" | "T2";

/** One row of the Small turret charge reference table. */
export interface AmmoChargeRow {
  typeId: number;
  name: string;
  tier: AmmoTier;
  family: AmmoFamily;
  /** The turret class this charge is restricted to — set for T2 rows only. */
  turretClass: string | null;
  em: number;
  thermal: number;
  kinetic: number;
  explosive: number;
  totalDamage: number;
  optimalMult: number;
  falloffMult: number;
  trackingMult: number;
  /** Percent cap-use bonus (e.g. `25` = +25%). `null` for Projectile, which
   * never carries this attribute. */
  capNeedBonusPct: number | null;
}

/** The Small turret charge reference table for one family (T1/Navy/T2). */
export function ammoReference(family: AmmoFamily): Promise<AmmoChargeRow[]> {
  return invoke<AmmoChargeRow[]>("ammo_reference", { family });
}
