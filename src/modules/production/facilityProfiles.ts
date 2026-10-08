// Facility-profile composition + persistence for the Production module.
//
// Mirrors the Rust `FacilityProfile`/`FacilityProfiles` types. The frontend
// composes structure + selected rig type IDs into `FacilityProfile` objects
// that get sent to the Rust engine via `ProfitParams.facilityProfiles`.
// Rig bonuses are computed by the backend from `rigTypeIds` + security,
// so the frontend just selects rig types (checkboxes) and stores the
// pre-computed `meBonus`/`teBonusPct`/`costBonus` from the API call.

import { STORAGE_KEYS } from "../../lib/storageKeys";

export type { FacilityProfiles } from "./types";
import { productionRigBonuses } from "../../lib/api/production";
import type {
  FacilityProfile,
  FacilityProfiles,
  FacilityStructureKey,
  SecurityTierKey,
} from "./types";
import { FACILITY_STRUCTURES, SECURITY_TIERS } from "./types";

/** Compose a `FacilityProfile` from its raw parts. `rigTypeIds` are the
 * selected rig type IDs. The bonus fields hold the **structure base** values;
 * call [`applyRigBonuses`] to compute the full totals from rigs + security. */
export function composeFacilityProfile(
  facilityType: FacilityProfile["facilityType"],
  structure: FacilityStructureKey,
  security: SecurityTierKey,
  rigTypeIds: number[],
  systemCostIndex: number | null,
  taxRate: number | null,
): FacilityProfile {
  const s = FACILITY_STRUCTURES[structure];
  return {
    facilityType,
    structure,
    security,
    meBonus: s.meBonus,
    teBonusPct: s.tePct,
    costBonus: s.costBonus,
    roleBonusTime: s.roleBonusTime,
    rigTypeIds: rigTypeIds ?? [],
    systemCostIndex,
    taxRate,
    systemId: null,
  };
}

/** Call the backend to compute rig bonuses from `rigTypeIds` + security, then
 * return an updated `FacilityProfile` with combined bonuses
 * (structure base × rig, matching Rust `from_structure`). */
export async function applyRigBonuses(
  profile: FacilityProfile,
  rigTypeIds: number[],
): Promise<FacilityProfile> {
  const s = FACILITY_STRUCTURES[profile.structure];
  const [rigMe, rigTe, rigCostPct] = await productionRigBonuses(
    rigTypeIds,
    profile.security,
  );
  return {
    ...profile,
    rigTypeIds,
    meBonus: s.meBonus * rigMe,
    teBonusPct: s.tePct + rigTe,
    costBonus: 1.0 - (1.0 - s.costBonus) * (1.0 - rigCostPct / 100.0),
  };
}

/** Default manufacturing profile: NPC station, no rigs, no overrides. */
export function defaultManufacturingProfile(): FacilityProfile {
  return composeFacilityProfile(
    "manufacturing",
    "npcStation",
    "highsec",
    [],
    null,
    null,
  );
}

/** Default reaction profile: NPC station (fallback when no reaction
 * facility is configured). */
export function defaultReactionProfile(): FacilityProfile {
  return composeFacilityProfile(
    "reaction",
    "npcStation",
    "highsec",
    [],
    null,
    null,
  );
}

/** Default components profile: NPC station, no rigs, no overrides.
 *  Matches the Rust backend's `FacilityProfile::default()` for components. */
export function defaultComponentsProfile(): FacilityProfile {
  return composeFacilityProfile(
    "components",
    "npcStation",
    "highsec",
    [],
    null,
    null,
  );
}

/** Default facility profiles triple. Field order MUST match Rust
 * `FacilityProfiles` (manufacturing → components → reaction) and the TS
 * interface — a mismatch swaps component/reaction on every persistence round. */
export function defaultFacilityProfiles(): FacilityProfiles {
  return {
    manufacturing: defaultManufacturingProfile(),
    components: defaultComponentsProfile(),
    reaction: defaultReactionProfile(),
  };
}

/** Whether ANY profile in the triple is approximate. */
export function isApproximate(profiles: FacilityProfiles): boolean {
  return (
    profiles.manufacturing.systemCostIndex === null ||
    profiles.manufacturing.taxRate === null ||
    profiles.reaction.systemCostIndex === null ||
    profiles.reaction.taxRate === null ||
    profiles.components.systemCostIndex === null ||
    profiles.components.taxRate === null
  );
}

export function securityHasNoLiveIndex(tier: SecurityTierKey): boolean {
  return SECURITY_TIERS[tier].hasNoLiveCostIndex;
}

/** Human-readable label for a facility profile. */
export function facilityProfileLabel(p: FacilityProfile): string {
  const s = FACILITY_STRUCTURES[p.structure];
  const sec = SECURITY_TIERS[p.security].label;
  const rigs = p.rigTypeIds?.length ?? 0;
  const rigPart = rigs > 0 ? ` (${rigs} rig${rigs > 1 ? "s" : ""})` : "";
  return `${s.label}, ${sec}${rigPart}`;
}

// --- Persistence ---

export function loadFacilityProfiles(): FacilityProfiles {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.facilityProfiles);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FacilityProfiles>;
      // Order MUST match types.ts + Rust FacilityProfiles (manufacturing →
      // components → reaction); otherwise the components and reaction halves
      // get swapped on every localStorage round-trip.
      return {
        manufacturing: {
          ...defaultManufacturingProfile(),
          ...parsed.manufacturing,
        },
        components: {
          ...defaultComponentsProfile(),
          ...parsed.components,
        },
        reaction: {
          ...defaultReactionProfile(),
          ...parsed.reaction,
        },
      };
    }
  } catch {
    // Corrupt storage → fall back to defaults.
  }
  return defaultFacilityProfiles();
}

export function saveFacilityProfiles(profiles: FacilityProfiles): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.facilityProfiles,
      JSON.stringify(profiles),
    );
  } catch {
    // Storage full or disabled.
  }
}

export function exportFacilityProfiles(profiles: FacilityProfiles): string {
  return JSON.stringify(profiles, null, 2);
}

export function importFacilityProfiles(json: string): FacilityProfiles {
  try {
    const parsed = JSON.parse(json) as Partial<FacilityProfiles>;
    return {
      manufacturing: {
        ...defaultManufacturingProfile(),
        ...parsed.manufacturing,
      },
      reaction: {
        ...defaultReactionProfile(),
        ...parsed.reaction,
      },
      components: {
        ...defaultComponentsProfile(),
        ...parsed.components,
      },
    };
  } catch {
    return defaultFacilityProfiles();
  }
}
