import { STORAGE_KEYS } from "../../lib/storageKeys";

export type ResultsView =
  "opportunities" | "favorites" | "blacklist" | "library";

// --- Facility profile types (mirror Rust `FacilityProfile`/`FacilityProfiles`) ---

/** A blueprint the user imported to model (not necessarily owned via ESI). */
export interface ImportedBlueprint {
  typeId: number;
  name: string;
  me: number;
  te: number;
}

export const IMPORTED_BP_KEY = STORAGE_KEYS.importedBlueprints;

export function loadImported(): ImportedBlueprint[] {
  try {
    const raw = localStorage.getItem(IMPORTED_BP_KEY);
    return raw ? (JSON.parse(raw) as ImportedBlueprint[]) : [];
  } catch {
    return [];
  }
}

export const FORGE = 10000002;

export type Tab =
  "item" | "market" | "industry" | "thresholds" | "paste" | "facilities";

// --- Facility profile types (mirror Rust `FacilityProfile`/`FacilityProfiles`) ---

export type FacilityType = "manufacturing" | "reaction" | "components";

export type FacilityStructureKey =
  "npcStation" | "raitaru" | "azbel" | "sotiyo" | "athanor" | "tatara";

export const FACILITY_STRUCTURES: Record<
  FacilityStructureKey,
  {
    label: string;
    /** Combined ME multiplier (1.0 = none, 0.99 = −1%). */
    meBonus: number;
    /** TE bonus percent (e.g. 15 = −15% time). */
    tePct: number;
    /** Cost saving fraction (0.03 = −3%). */
    costBonus: number;
    /** Tatara role-bonus time multiplier (0.25 = −25%). */
    roleBonusTime: number;
    /** Which activity this structure hosts. */
    facilityType: FacilityType;
  }
> = {
  npcStation: {
    label: "NPC station",
    meBonus: 1.0,
    tePct: 0,
    costBonus: 0,
    roleBonusTime: 0,
    facilityType: "manufacturing",
  },
  raitaru: {
    label: "Raitaru",
    meBonus: 0.99,
    tePct: 15,
    costBonus: 0.03,
    roleBonusTime: 0,
    facilityType: "manufacturing",
  },
  azbel: {
    label: "Azbel",
    meBonus: 0.99,
    tePct: 20,
    costBonus: 0.04,
    roleBonusTime: 0,
    facilityType: "manufacturing",
  },
  sotiyo: {
    label: "Sotiyo",
    meBonus: 0.99,
    tePct: 30,
    costBonus: 0.05,
    roleBonusTime: 0,
    facilityType: "manufacturing",
  },
  athanor: {
    label: "Athanor",
    meBonus: 0.99,
    tePct: 0,
    costBonus: 0.04,
    roleBonusTime: 0,
    facilityType: "reaction",
  },
  tatara: {
    label: "Tatara",
    meBonus: 0.99,
    tePct: 0,
    costBonus: 0.05,
    roleBonusTime: 0.25,
    facilityType: "reaction",
  },
};

export type SecurityTierKey = "highsec" | "lowsec" | "nullsec" | "wormhole";

export const SECURITY_TIERS: Record<
  SecurityTierKey,
  { label: string; hasNoLiveCostIndex: boolean }
> = {
  highsec: { label: "Highsec", hasNoLiveCostIndex: false },
  lowsec: { label: "Lowsec", hasNoLiveCostIndex: false },
  nullsec: { label: "Nullsec", hasNoLiveCostIndex: false },
  wormhole: { label: "Wormhole", hasNoLiveCostIndex: true },
};

/** A production-capacity profile for one facility type (manufacturing or
 *  reaction). Matches Rust `FacilityProfile`. */
export interface FacilityProfile {
  facilityType: FacilityType;
  structure: FacilityStructureKey;
  security: SecurityTierKey;
  /** Combined structure+rig ME multiplier (e.g. 0.97 = −3%). */
  meBonus: number;
  /** Combined structure+rig TE bonus percent (e.g. 20 = −20% time). */
  teBonusPct: number;
  /** Combined structure+rig cost saving fraction (0..1). */
  costBonus: number;
  /** Tatara role-bonus time (0.25) or 0 otherwise. */
  roleBonusTime: number;
  /** System cost index (0..1), or null for WH. */
  systemCostIndex: number | null;
  /** Facility tax rate (0..1), or null for manual override. */
  taxRate: number | null;
  /** Selected rig type IDs — the program computes ME/TE/cost from these. */
  rigTypeIds: number[];
}

/** A triple of facility profiles: manufacturing, reaction, + components.
 *  Matches Rust `FacilityProfiles`. */
export interface FacilityProfiles {
  manufacturing: FacilityProfile;
  reaction: FacilityProfile;
  components: FacilityProfile;
}

/** Storage key for saved facility profiles. */
export const FACILITY_PROFILES_STORAGE_KEY = "production.facilityProfiles";
