import { invoke } from "@tauri-apps/api/core";

/** Mass Production's material-sourcing mode (#893). "owned" is #883's
 * original, unchanged behavior; "hypothetical" assumes a rule-derived
 * (runs, ME) per pasted blueprint instead of real ESI ownership. */
export type PlanMode = "owned" | "hypothetical";

/** User-configurable knobs for Hypothetical mode (#893), shown in the UI's
 * settings row only in that mode. */
export interface HypotheticalConfig {
  /** Assumed run count for a T1 (or special-edition) blueprint. Default: 1. */
  t1Runs: number;
  /** Assumed ME for a T1 blueprint. Default: 10 (best BPO research). */
  t1Me: number;
  /** Assumed ME for a T2 blueprint. Default: 2 (base-invented, no
   * decryptor — a fixed EVE invention-mechanics constant). */
  t2Me: number;
}

export const DEFAULT_HYPOTHETICAL_CONFIG: HypotheticalConfig = {
  t1Runs: 1,
  t1Me: 10,
  t2Me: 2,
};

/** One pasted "blueprint to build" line: a name plus an optional explicit
 * build-run override — "how many should be built" for that one line,
 * replacing the mode's default (the rule-derived Hypothetical assumption,
 * or the full real Owned total). `buildRuns` omitted/`null` keeps that
 * default unchanged. */
export interface BlueprintLine {
  name: string;
  buildRuns?: number | null;
}

/** The rule-derived (runs, ME) Hypothetical mode assumed for one pasted
 * blueprint (#893), plus whether the special-edition ME0 rule fired. */
export interface AssumedBlueprint {
  runs: number;
  materialEfficiency: number;
  specialEdition: boolean;
}

/** One pasted blueprint name resolved against the SDE, with what's actually
 * owned across the roster/corp hangars (Owned mode) or assumed (Hypothetical
 * mode). */
export interface MatchedBlueprint {
  name: string;
  typeId: number;
  /** Total physical BPC copies owned across the roster/corp hangars in Owned
   * mode. Always `1` in Hypothetical mode (one synthetic assumed "copy" per
   * pasted line) — see `assumed` for the actual assumption. Excludes BPOs —
   * they have no bounded "remaining runs" to sum. */
  ownedCopies: number;
  /** Sum of `runs` across every owned/assumed copy — or, when the line's
   * `buildRuns` override is set, exactly that (Hypothetical mode) or that
   * many of the real owned runs, best-ME first (Owned mode). */
  totalRuns: number;
  /** The Hypothetical-mode assumption behind `ownedCopies`/`totalRuns`.
   * `null` in Owned mode. */
  assumed: AssumedBlueprint | null;
  /** The blueprint product's meta-group tier — "Tech I", "Tech II",
   * "Faction", "Officer", or "Deadspace" — for grouping a long pasted list
   * by tech level. */
  tier: string;
}

/** One material line inside a `MaterialGroup`. */
export interface PlanItem {
  typeId: number;
  name: string;
  quantity: number;
}

/** Aggregated materials for one `invGroups.groupName` bucket (e.g.
 * "Mineral", "Refined Commodities - Tier 2"). */
export interface MaterialGroup {
  groupName: string;
  /** The group's parent `invCategories.categoryName`, for a secondary label. */
  categoryName: string;
  items: PlanItem[];
}

/** Result of `massprodPlan`: what didn't resolve, what was matched against
 * owned/assumed copies, and the materials to buy, grouped for Multibuy. */
export interface MassProductionPlan {
  unresolvedNames: string[];
  matchedBlueprints: MatchedBlueprint[];
  groups: MaterialGroup[];
}

/**
 * Paste a list of blueprint lines and get a Mass Production plan. In "owned"
 * mode (#883, unchanged): each name is matched against every copy the
 * roster/corp actually own (real ME/runs, personal + corp hangars). In
 * "hypothetical" mode (#893): no ESI ownership calls are made at all — each
 * name is assumed at a rule-derived (runs, ME) instead, using
 * `hypotheticalConfig`'s overrides. Either way, materials are summed per
 * owned/assumed copy — never averaged across copies at different ME/runs —
 * and bucketed by `invGroups.groupName` into Multibuy-ready shopping groups.
 *
 * A line's `buildRuns` overrides "how many should be built" for that one
 * blueprint: in Hypothetical mode it replaces the assumed run count; in
 * Owned mode it caps the real owned total down to that many runs (best-ME
 * copies first).
 */
export function massprodPlan(
  lines: BlueprintLine[],
  mode: PlanMode,
  hypotheticalConfig: HypotheticalConfig = DEFAULT_HYPOTHETICAL_CONFIG,
): Promise<MassProductionPlan> {
  return invoke<MassProductionPlan>("massprod_plan", {
    lines,
    mode,
    hypotheticalConfig,
  });
}

/** One saved line in a build list: a resolved blueprint plus its (optional)
 * saved build-run override. */
export interface BuildListItem {
  typeId: number;
  name: string;
  buildRuns: number | null;
}

/** A named, reusable Mass Production build list — the pasted blueprints
 * (and any per-line "how many to build" overrides) saved for replay. */
export interface BuildList {
  id: string;
  name: string;
  items: BuildListItem[];
}

/** Every saved build list. */
export function massprodLists(): Promise<BuildList[]> {
  return invoke<BuildList[]>("massprod_lists");
}

/** Save the current build list (matched blueprints + any per-line run
 * overrides) under a name, returning the saved list. */
export function massprodSaveList(
  name: string,
  items: { typeId: number; buildRuns?: number | null }[],
): Promise<BuildList> {
  return invoke<BuildList>("massprod_save_list", { name, items });
}

/** Delete a saved build list. */
export function massprodDeleteList(id: string): Promise<void> {
  return invoke<void>("massprod_delete_list", { id });
}
