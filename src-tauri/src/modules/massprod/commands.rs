//! Tauri command surface for the Mass Production module (#883, #893).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::esi::commands::owned_blueprints_core;
use crate::esi::AuthState;
use crate::modules::production::{required_quantity, BASE_T2_ME};
use crate::sde::BlueprintMaterial;

/// Mass Production's material-sourcing mode (#893). "Owned" is #883's
/// original, unchanged behavior: plan against real ESI-owned blueprint
/// copies. "Hypothetical" assumes a rule-derived `(runs, ME)` per pasted
/// blueprint instead — no ESI ownership calls at all — for pre-purchase
/// planning when nothing is owned yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanMode {
    Owned,
    Hypothetical,
}

/// User-configurable knobs for Hypothetical mode (#893), surfaced in the
/// UI's settings row (hidden in Owned mode, where they're unused).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HypotheticalConfig {
    /// Assumed run count for a T1 (or special-edition) blueprint. Default: 1
    /// run — the conservative "what would just one build cost" baseline a
    /// pre-purchase/contract check usually wants; override for batch
    /// planning (e.g. assuming everyone pastes max-run BPCs).
    #[serde(default = "default_t1_runs")]
    pub t1_runs: i64,
    /// Assumed ME for a T1 blueprint: 10, the max level researchable on a
    /// player-owned BPO ("best BPO research" per #893's acceptance criteria).
    #[serde(default = "default_t1_me")]
    pub t1_me: i64,
    /// Assumed ME for a T2 blueprint: `production::BASE_T2_ME` (2) — the
    /// material efficiency of a freshly invented T2 BPC with no decryptor
    /// applied, a fixed EVE invention-mechanics constant, not a guess.
    #[serde(default = "default_t2_me")]
    pub t2_me: i64,
    /// Combined structure+rig ME multiplier (1.0 = none, 0.99 = −1%). Passed
    /// through to [`required_quantity`] so the mass-prod material list matches
    /// the user's chosen facility + rigs (#883), not the old hardcoded 1.0.
    #[serde(default = "default_me_bonus")]
    pub me_bonus: f64,
}

impl Default for HypotheticalConfig {
    fn default() -> Self {
        Self {
            t1_runs: default_t1_runs(),
            t1_me: default_t1_me(),
            t2_me: default_t2_me(),
            me_bonus: default_me_bonus(),
        }
    }
}

fn default_t1_runs() -> i64 {
    1
}

fn default_t1_me() -> i64 {
    10
}

fn default_t2_me() -> i64 {
    BASE_T2_ME
}

fn default_me_bonus() -> f64 {
    1.0
}

/// One pasted "blueprint to build" line: a name plus an optional explicit
/// build-run override — lets a user say "build exactly N runs of this"
/// instead of accepting the mode's default (the rule-derived Hypothetical
/// assumption, or the full real Owned total). `None`/absent keeps that
/// default unchanged.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintLine {
    pub name: String,
    #[serde(default)]
    pub build_runs: Option<i64>,
}

/// The rule-derived `(runs, ME)` Hypothetical mode assumed for one pasted
/// blueprint (#893), plus whether the special-edition ME0 rule fired —
/// surfaced so the UI can visibly flag it (so the user knows a different
/// rule applied here than the T1/T2 default, not that it silently guessed).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssumedBlueprint {
    pub runs: i64,
    pub material_efficiency: i64,
    pub special_edition: bool,
}

/// One pasted blueprint name resolved against the SDE, with what's actually
/// owned across the roster/corp hangars (Owned mode) or assumed (Hypothetical
/// mode).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchedBlueprint {
    /// Resolved SDE type name (not the raw pasted line — normalizes case/
    /// whitespace the same way every other paste-import command does).
    pub name: String,
    pub type_id: i64,
    /// Total physical BPC copies owned across the roster/corp hangars in
    /// Owned mode. In Hypothetical mode this is always `1` — one synthetic
    /// assumed "copy" per pasted line — so the same summation logic below
    /// applies unmodified in both modes; see `assumed` for the actual
    /// assumption. Excludes BPOs (`runs == -1`) — a BPO has no bounded
    /// "remaining runs" to sum, so it never contributes to `total_runs` or
    /// the materials below.
    pub owned_copies: i64,
    /// Sum of `runs` across every owned/assumed copy (a stack of N identical
    /// copies at R runs each counts as `N * R`).
    pub total_runs: i64,
    /// The Hypothetical-mode assumption behind `owned_copies`/`total_runs`
    /// for this line. `None` in Owned mode, where those fields are real ESI
    /// data (#893).
    pub assumed: Option<AssumedBlueprint>,
    /// The blueprint product's meta-group tier — "Tech I", "Tech II",
    /// "Faction", "Officer", or "Deadspace" (absent from `invMetaTypes`
    /// defaults to "Tech I", the SDE's own convention) — so the UI can
    /// group a long pasted list by tier, the same way Hypothetical mode
    /// already classifies it for the assumption rules.
    pub tier: String,
}

/// One material line inside a [`MaterialGroup`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub type_id: i64,
    pub name: String,
    pub quantity: i64,
}

/// Aggregated materials for one `invGroups.groupName` bucket (e.g. "Mineral",
/// "Refined Commodities - Tier 2") — finer than category, which is what
/// actually separates PI tiers, minerals, and composites from each other.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialGroup {
    pub group_name: String,
    /// The group's parent `invCategories.categoryName`, for a secondary label.
    pub category_name: String,
    pub items: Vec<PlanItem>,
}

/// Result of `massprod_plan`: what didn't resolve, what was matched against
/// owned/assumed copies, and the materials to buy, grouped for Multibuy.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MassProductionPlan {
    /// Pasted lines that matched no SDE type name.
    pub unresolved_names: Vec<String>,
    pub matched_blueprints: Vec<MatchedBlueprint>,
    pub groups: Vec<MaterialGroup>,
}

/// Sum of ME-adjusted material requirements across every owned/assumed
/// run-limited copy of one blueprint type. Each `(runs, me, count)` tuple is
/// a stack of `count` identical copies (ESI already merges identical
/// untouched BPCs under one row's `quantity`; Hypothetical mode always feeds
/// a single synthetic `count = 1` entry) — every stack's per-copy requirement
/// is computed independently at its own ME/runs via [`required_quantity`],
/// then summed. Copies at different ME/runs are not fungible, so this must
/// never collapse to an average across copies (#883). Pure — no SDE/network
/// access — so it's unit-tested directly.
fn sum_copy_materials(
    materials: &[BlueprintMaterial],
    copies: &[(i64, i64, i64)], // (runs, material_efficiency, count)
    me_bonus: f64,
) -> HashMap<i64, i64> {
    let mut totals: HashMap<i64, i64> = HashMap::new();
    for &(runs, me, count) in copies {
        if runs <= 0 || count <= 0 {
            continue;
        }
        for m in materials {
            let per_copy = required_quantity(m.quantity, runs, me, me_bonus);
            *totals.entry(m.material_type_id).or_insert(0) += per_copy * count;
        }
    }
    totals
}

/// A stack's copy count: a positive `quantity` is a real stack of identical
/// copies; `-2` (single BPC) and `-1` (BPO, filtered out before this by its
/// `runs`) both count as one physical item.
fn stack_count(quantity: i64) -> i64 {
    if quantity > 0 {
        quantity
    } else {
        1
    }
}

/// Resolved blueprint lines: pasted-line resolution order (type ids, first
/// seen), the resolved name for each, each type's build-run override (from
/// the first-seen line only, same dedup convention as the name), and every
/// pasted line that resolved to nothing.
type ResolvedBlueprintLines = (
    Vec<i64>,
    HashMap<i64, String>,
    HashMap<i64, Option<i64>>,
    Vec<String>,
);

/// Resolve every pasted line to an SDE type id, in first-seen order,
/// de-duplicating repeated names (case/whitespace already normalized by
/// `type_by_name`'s case-insensitive match) — a later duplicate's
/// `build_runs` is ignored along with the rest of its line, same as before.
/// Blank names are skipped. Lines that don't resolve to any type are
/// returned as `unresolved_names`, the same reporting shape
/// `shopping_add_text` already uses.
fn resolve_blueprint_lines(
    sde: &crate::sde::Sde,
    lines: &[BlueprintLine],
) -> Result<ResolvedBlueprintLines, String> {
    let mut order = Vec::new();
    let mut names: HashMap<i64, String> = HashMap::new();
    let mut build_runs: HashMap<i64, Option<i64>> = HashMap::new();
    let mut unresolved = Vec::new();
    for line in lines {
        let trimmed = line.name.trim();
        if trimmed.is_empty() {
            continue;
        }
        match sde.type_by_name(trimmed).map_err(|e| e.to_string())? {
            Some((type_id, _volume)) => {
                if let std::collections::hash_map::Entry::Vacant(e) = names.entry(type_id) {
                    order.push(type_id);
                    e.insert(sde.type_name_or_id(type_id));
                    build_runs.insert(type_id, line.build_runs);
                }
            }
            None => unresolved.push(line.name.clone()),
        }
    }
    Ok((order, names, build_runs, unresolved))
}

/// The blueprint PRODUCT's meta-group tier — "Tech I", "Tech II",
/// "Faction", "Officer", or "Deadspace" (absent from `invMetaTypes`
/// defaults to "Tech I", the SDE's own convention). Shared by
/// `assume_blueprint`'s Hypothetical-mode rule classification and
/// `massprod_plan`'s build-list grouping, so a blueprint's displayed tier
/// always lines up with the rule that was (or would be) applied to it.
fn product_tier(
    sde: &crate::sde::Sde,
    meta_group_names: &crate::sde::NameMap,
    blueprint_type_id: i64,
) -> Result<String, String> {
    let product_type_id = sde
        .blueprint_product(blueprint_type_id)
        .map_err(|e| e.to_string())?
        .map(|p| p.product_type_id)
        .unwrap_or(blueprint_type_id);
    Ok(meta_group_names
        .get(&product_type_id)
        .cloned()
        .unwrap_or_else(|| "Tech I".to_string()))
}

/// Caps a blueprint's owned `(runs, me, count)` stacks down to at most
/// `cap` total runs (a per-line "how many to build" override in Owned
/// mode) — consuming the stacks in the order given (callers sort by ME
/// descending so the cheapest-material copies are used first) and, if the
/// cap falls inside a stack, splitting off a single partial-run copy so the
/// cap is hit exactly without ever overshooting. Every kept copy still uses
/// its own real `(runs, me)` — this never averages across differently-
/// propertied copies, just chooses which whole/partial copies to include. A
/// `cap` at or beyond the natural total is a no-op (every stack kept
/// unchanged); a `cap` of `0` or below drops everything.
fn cap_to_runs(copies: Vec<(i64, i64, i64)>, cap: i64) -> Vec<(i64, i64, i64)> {
    let mut remaining = cap.max(0);
    let mut kept = Vec::with_capacity(copies.len());
    for (runs, me, count) in copies {
        if remaining <= 0 || runs <= 0 || count <= 0 {
            continue;
        }
        let stack_total = runs * count;
        if stack_total <= remaining {
            kept.push((runs, me, count));
            remaining -= stack_total;
            continue;
        }
        let whole = remaining / runs;
        if whole > 0 {
            kept.push((runs, me, whole));
            remaining -= whole * runs;
        }
        if remaining > 0 {
            kept.push((remaining, me, 1));
            remaining = 0;
        }
    }
    kept
}

/// Rule-derived `(runs, ME)` for one pasted blueprint in Hypothetical mode
/// (#893), and whether the special-edition ME0 rule fired. Classification is
/// by the *product's* meta group — the same `meta_group_names`/
/// `cached_meta_group_names` lookup production/daytrading/trading already use
/// for tech-level classification, reused here rather than duplicated:
///
/// - Faction/Officer/Deadspace-tier product: ME 0 — these are typically
///   invention- or LP-store-sourced items where a player "best BPO research"
///   assumption doesn't apply — and the configured T1 run count (the issue
///   specifies no separate run rule for this tier, only ME).
/// - T2 product (meta group "Tech II"): runs = the blueprint's own SDE
///   `maxProductionLimit` (the real per-BPC run cap CCP defines for that
///   blueprint type — falls back to the configured T1 run count on the rare
///   SDE gap rather than failing the whole plan); ME = the configured T2-ME
///   override (default [`BASE_T2_ME`], EVE's base-invented ME with no
///   decryptor).
/// - Everything else (T1/standard, including "Tech I" — absent from
///   `invMetaTypes` defaults to Tech I, the SDE's own convention): the
///   configured T1 run count and ME.
fn assume_blueprint(
    sde: &crate::sde::Sde,
    meta_group_names: &crate::sde::NameMap,
    blueprint_type_id: i64,
    config: &HypotheticalConfig,
) -> Result<AssumedBlueprint, String> {
    let product_type_id = sde
        .blueprint_product(blueprint_type_id)
        .map_err(|e| e.to_string())?
        .map(|p| p.product_type_id)
        .unwrap_or(blueprint_type_id);
    let meta_group = meta_group_names.get(&product_type_id).map(String::as_str);

    if matches!(
        meta_group,
        Some("Faction") | Some("Officer") | Some("Deadspace")
    ) {
        return Ok(AssumedBlueprint {
            runs: config.t1_runs,
            material_efficiency: 0,
            special_edition: true,
        });
    }

    if meta_group == Some("Tech II") {
        let runs = sde
            .max_production_limit(blueprint_type_id)
            .map_err(|e| e.to_string())?
            .unwrap_or(config.t1_runs);
        return Ok(AssumedBlueprint {
            runs,
            material_efficiency: config.t2_me,
            special_edition: false,
        });
    }

    Ok(AssumedBlueprint {
        runs: config.t1_runs,
        material_efficiency: config.t1_me,
        special_edition: false,
    })
}

/// Paste a list of blueprint names (one per line) and get a Mass Production
/// plan. In [`PlanMode::Owned`] (#883's reference behavior, unchanged): each
/// name is matched against every copy the roster/corp actually own (real
/// ME/runs, personal + corp hangars). In [`PlanMode::Hypothetical`] (#893):
/// no ESI ownership calls are made at all — each name is assumed at a
/// rule-derived `(runs, ME)` instead (see [`assume_blueprint`]). Either way,
/// materials are summed per owned/assumed copy — never averaged across
/// copies at different ME/runs — and bucketed by `invGroups.groupName` into
/// Multibuy-ready shopping groups.
///
/// Each pasted line may carry an explicit `build_runs` override: in
/// Hypothetical mode it replaces the rule-derived assumed run count for
/// that one blueprint; in Owned mode it caps the real owned total down to
/// that many runs, consuming the best-ME copies first (see
/// [`cap_to_runs`]). Every matched blueprint is also tagged with its
/// product's tier ([`product_tier`]) so the UI can group a long pasted list
/// by tech level.
#[tauri::command]
pub async fn massprod_plan(
    app: AppHandle,
    auth_state: State<'_, AuthState>,
    lines: Vec<BlueprintLine>,
    mode: PlanMode,
    hypothetical_config: Option<HypotheticalConfig>,
) -> Result<MassProductionPlan, crate::model::AppError> {
    let hypothetical_config = hypothetical_config.unwrap_or_default();
    let (dir, sde) = crate::sde::dir_and_sde(&app)?;

    let (order, names, build_runs, unresolved_names) = resolve_blueprint_lines(&sde, &lines)?;
    let meta = crate::sde::cached_meta_group_names(&dir)?;

    // Each resolved blueprint's `(runs, ME, count)` stacks to sum materials
    // over: real ESI-owned copies in Owned mode, or one synthetic assumed
    // "copy" per line in Hypothetical mode — both branches feed the exact
    // same `sum_copy_materials`/`required_quantity` math below (#893).
    let mut copies_by_type: HashMap<i64, Vec<(i64, i64, i64)>> = HashMap::new();
    let mut assumed_by_type: HashMap<i64, AssumedBlueprint> = HashMap::new();

    match mode {
        PlanMode::Owned => {
            let owned = owned_blueprints_core(&dir, &auth_state).await?;
            for bp in &owned {
                copies_by_type.entry(bp.type_id).or_default().push((
                    bp.runs,
                    bp.material_efficiency,
                    stack_count(bp.quantity),
                ));
            }
        }
        PlanMode::Hypothetical => {
            for &type_id in &order {
                let mut assumed = assume_blueprint(&sde, &meta, type_id, &hypothetical_config)?;
                if let Some(Some(cap)) = build_runs.get(&type_id) {
                    assumed.runs = (*cap).max(0);
                }
                copies_by_type.insert(
                    type_id,
                    vec![(assumed.runs, assumed.material_efficiency, 1)],
                );
                assumed_by_type.insert(type_id, assumed);
            }
        }
    }

    let mut matched_blueprints = Vec::with_capacity(order.len());
    let mut material_totals: HashMap<i64, i64> = HashMap::new();

    for type_id in &order {
        let mut copies = copies_by_type.get(type_id).cloned().unwrap_or_default();
        if mode == PlanMode::Owned {
            if let Some(Some(cap)) = build_runs.get(type_id) {
                // Best ME (cheapest material use) first, so a capped build
                // always consumes the most efficient owned copies.
                copies.sort_by_key(|&(_, me, _)| std::cmp::Reverse(me));
                copies = cap_to_runs(copies, *cap);
            }
        }
        let owned_copies: i64 = copies
            .iter()
            .filter(|&&(runs, _, _)| runs > 0)
            .map(|&(_, _, count)| count)
            .sum();
        let total_runs: i64 = copies
            .iter()
            .filter(|&&(runs, _, _)| runs > 0)
            .map(|&(runs, _, count)| runs * count)
            .sum();

        matched_blueprints.push(MatchedBlueprint {
            name: names[type_id].clone(),
            type_id: *type_id,
            owned_copies,
            total_runs,
            assumed: assumed_by_type.get(type_id).copied(),
            tier: product_tier(&sde, &meta, *type_id)?,
        });

        if owned_copies > 0 {
            let materials = sde
                .blueprint_materials(*type_id)
                .map_err(|e| e.to_string())?;
            for (material_type_id, qty) in
                sum_copy_materials(&materials, &copies, hypothetical_config.me_bonus)
            {
                *material_totals.entry(material_type_id).or_insert(0) += qty;
            }
        }
    }

    let group_names = crate::sde::cached_group_names(&dir)?;
    let category_names = crate::sde::cached_category_names(&dir)?;
    let mut groups_by_name: HashMap<String, MaterialGroup> = HashMap::new();
    for (type_id, quantity) in material_totals {
        let group_name = group_names
            .get(&type_id)
            .cloned()
            .unwrap_or_else(|| "Other".to_string());
        let category_name = category_names.get(&type_id).cloned().unwrap_or_default();
        groups_by_name
            .entry(group_name.clone())
            .or_insert_with(|| MaterialGroup {
                group_name,
                category_name,
                items: Vec::new(),
            })
            .items
            .push(PlanItem {
                type_id,
                name: sde.type_name_or_id(type_id),
                quantity,
            });
    }

    let mut groups: Vec<MaterialGroup> = groups_by_name.into_values().collect();
    for g in &mut groups {
        g.items.sort_by(|a, b| a.name.cmp(&b.name));
    }
    groups.sort_by(|a, b| a.group_name.cmp(&b.group_name));

    Ok(MassProductionPlan {
        unresolved_names,
        matched_blueprints,
        groups,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sde::test_sde;

    fn material(type_id: i64, quantity: i64) -> BlueprintMaterial {
        BlueprintMaterial {
            material_type_id: type_id,
            name: format!("Material {type_id}"),
            quantity,
        }
    }

    #[test]
    fn sums_per_copy_instead_of_averaging_me_and_runs() {
        // Two copies of the same blueprint at different ME/runs: 1 copy at
        // ME0/10 runs, 1 copy at ME10/5 runs. A base quantity of 100.
        let materials = vec![material(11399, 100)];
        let copies = vec![(10, 0, 1), (5, 10, 1)];

        let totals = sum_copy_materials(&materials, &copies, 1.0);

        // Correct (per-copy, summed): ceil(100*10*1.0) + ceil(100*5*0.9)
        //   = 1000 + 450 = 1450.
        // Wrong (averaged runs=7.5, me=5 first): ceil(100*7.5*0.95) = 713,
        // a materially different (and lower) number — this is the bug #883
        // explicitly calls out.
        assert_eq!(totals[&11399], 1450);
    }

    #[test]
    fn stacked_identical_copies_multiply_by_count() {
        // A stack of 30 identical BPCs at ME2/runs10 (ESI's `quantity` field
        // for an untouched stack), base material quantity 17 (Morphite on a
        // real T2 blueprint).
        let materials = vec![material(11399, 17)];
        let copies = vec![(10, 2, 30)];

        let totals = sum_copy_materials(&materials, &copies, 1.0);

        // Per copy: ceil(17*10*0.98) = ceil(166.6) = 167; times 30 copies.
        assert_eq!(totals[&11399], 167 * 30);
    }

    #[test]
    fn bpos_and_empty_stacks_are_excluded() {
        let materials = vec![material(1, 5)];
        // runs = -1 marks a BPO (unbounded); count = 0 is a degenerate stack.
        let copies = vec![(-1, 0, 1), (10, 0, 0)];

        let totals = sum_copy_materials(&materials, &copies, 1.0);

        assert!(totals.is_empty());
    }

    #[test]
    fn stack_count_treats_negative_quantities_as_one() {
        assert_eq!(stack_count(-2), 1); // single BPC
        assert_eq!(stack_count(-1), 1); // BPO (filtered by runs elsewhere)
        assert_eq!(stack_count(12), 12); // real stack
    }

    /// Fixture for `assume_blueprint` tests: a T2 blueprint whose real-world
    /// SDE data we spot-checked locally (typeID 1073, "5MN Microwarpdrive II
    /// Blueprint": `maxProductionLimit` = 10, product meta group "Tech II"),
    /// a Faction blueprint, and a plain T1 blueprint with no meta entry.
    fn assume_fixture() -> crate::sde::Sde {
        test_sde(
            "CREATE TABLE invTypes(typeID INT, groupID INT, typeName TEXT, volume REAL);
             CREATE TABLE industryActivityProducts(typeID INT, activityID INT, productTypeID INT, quantity INT);
             CREATE TABLE invMetaGroups(metaGroupID INT, metaGroupName TEXT);
             CREATE TABLE invMetaTypes(typeID INT, parentTypeID INT, metaGroupID INT);
             CREATE TABLE industryBlueprints(typeID INT, maxProductionLimit INT);

             INSERT INTO invMetaGroups VALUES (2, 'Tech II'), (4, 'Faction');

             -- Real T2 blueprint (spot-checked against a local Fuzzwork SDE
             -- snapshot, 2026-09-25): 5MN Microwarpdrive II Blueprint (1073)
             -- manufactures 5MN Microwarpdrive II (440, Tech II), and its
             -- real maxProductionLimit is 10.
             INSERT INTO invTypes VALUES
               (1073, 1, '5MN Microwarpdrive II Blueprint', 0.01),
               (440, 1, '5MN Microwarpdrive II', 5.0);
             INSERT INTO invMetaTypes VALUES (440, NULL, 2);
             INSERT INTO industryActivityProducts VALUES (1073, 1, 440, 1);
             INSERT INTO industryBlueprints VALUES (1073, 10);

             -- A Faction-tier blueprint (LP-store style item).
             INSERT INTO invTypes VALUES
               (2000, 1, 'Republic Fleet Gyrostabilizer Blueprint', 0.01),
               (2001, 1, 'Republic Fleet Gyrostabilizer', 1.0);
             INSERT INTO invMetaTypes VALUES (2001, NULL, 4);
             INSERT INTO industryActivityProducts VALUES (2000, 1, 2001, 1);

             -- A plain T1 blueprint: no invMetaTypes row -> Tech I (absent).
             INSERT INTO invTypes VALUES
               (998, 1, 'Widget I Blueprint', 0.01),
               (999, 1, 'Widget I', 1.0);
             INSERT INTO industryActivityProducts VALUES (998, 1, 999, 1);",
        )
    }

    #[test]
    fn t2_blueprint_assumes_real_sde_max_production_limit_as_runs() {
        let sde = assume_fixture();
        let meta = sde.meta_group_names().unwrap();
        let config = HypotheticalConfig::default();

        let assumed = assume_blueprint(&sde, &meta, 1073, &config).unwrap();

        // Locks against the real Fuzzwork SDE value for "5MN Microwarpdrive
        // II Blueprint" (typeID 1073): maxProductionLimit = 10 (#893).
        assert_eq!(assumed.runs, 10);
        assert_eq!(assumed.material_efficiency, BASE_T2_ME);
        assert!(!assumed.special_edition);
    }

    #[test]
    fn faction_blueprint_assumes_me0_and_is_flagged() {
        let sde = assume_fixture();
        let meta = sde.meta_group_names().unwrap();
        let config = HypotheticalConfig::default();

        let assumed = assume_blueprint(&sde, &meta, 2000, &config).unwrap();

        assert_eq!(assumed.material_efficiency, 0);
        assert_eq!(assumed.runs, config.t1_runs);
        assert!(assumed.special_edition);
    }

    #[test]
    fn t1_blueprint_assumes_configured_runs_and_me10() {
        let sde = assume_fixture();
        let meta = sde.meta_group_names().unwrap();
        let config = HypotheticalConfig::default();

        let assumed = assume_blueprint(&sde, &meta, 998, &config).unwrap();

        assert_eq!(assumed.runs, config.t1_runs);
        assert_eq!(assumed.material_efficiency, 10);
        assert!(!assumed.special_edition);
    }

    #[test]
    fn t1_and_t2_me_overrides_are_honored() {
        let sde = assume_fixture();
        let meta = sde.meta_group_names().unwrap();
        let config = HypotheticalConfig {
            t1_runs: 5,
            t1_me: 8,
            t2_me: 4,
            me_bonus: 1.0,
        };

        let t1 = assume_blueprint(&sde, &meta, 998, &config).unwrap();
        assert_eq!(t1.runs, 5);
        assert_eq!(t1.material_efficiency, 8);

        let t2 = assume_blueprint(&sde, &meta, 1073, &config).unwrap();
        assert_eq!(t2.material_efficiency, 4);
        // T2 runs still come from the SDE's own maxProductionLimit, not the
        // T1 run override — only ME is configurable for T2.
        assert_eq!(t2.runs, 10);
    }

    #[test]
    fn cap_to_runs_below_natural_total_consumes_best_me_first() {
        // 3 copies at ME10/10runs (best), 2 copies at ME0/10runs (worst) —
        // 50 runs owned total. Capping to 25 should take the 3 best-ME
        // copies whole (30 runs) ... wait that overshoots; it should take
        // 2 whole best-ME copies (20 runs) then split a 5-run partial off
        // the third best-ME copy, never touching the worse-ME copies.
        let copies = vec![(10, 10, 3), (10, 0, 2)];
        let capped = cap_to_runs(copies, 25);
        assert_eq!(capped, vec![(10, 10, 2), (5, 10, 1)]);
        let total: i64 = capped.iter().map(|&(runs, _, count)| runs * count).sum();
        assert_eq!(total, 25);
    }

    #[test]
    fn cap_to_runs_at_or_above_natural_total_is_a_no_op() {
        let copies = vec![(10, 10, 3), (5, 0, 2)];
        assert_eq!(cap_to_runs(copies.clone(), 40), copies);
        assert_eq!(cap_to_runs(copies.clone(), 1000), copies);
    }

    #[test]
    fn cap_to_runs_zero_or_negative_drops_everything() {
        let copies = vec![(10, 10, 3)];
        assert!(cap_to_runs(copies.clone(), 0).is_empty());
        assert!(cap_to_runs(copies, -5).is_empty());
    }
}
