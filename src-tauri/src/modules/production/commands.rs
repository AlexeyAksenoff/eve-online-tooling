//! Tauri command surface for the production module.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::esi::EsiClient;
use crate::lists::{self, ListItem};
use crate::market::{
    deduplicated_cached_fetch_with_stale_fallback, default_region_id, location_label,
    resolve_location, KeyLocks, MarketService,
};
use crate::model::AppError;
use crate::sde::Sde;
use crate::storage;

use super::engine::{
    evaluate_with_stock, manufacturing_step, Activity, BuildStep, InputLine, Invention, PriceBasis,
    ProfitBreakdown, ProfitConfig, Sourcing,
};
use crate::sde::Recipe;

/// How deep the recursive build-vs-buy tree is resolved.
const MAX_TREE_DEPTH: u32 = 5;

/// Resolve a material into an [`InputLine`], recursively attaching a `Build`
/// sub-step when the material has a recipe (manufacturing or reaction). Recipes
/// are memoized; `path` guards against cycles.
#[allow(clippy::too_many_arguments)]
fn resolve_input(
    sde: &Sde,
    cache: &mut HashMap<i64, Option<Recipe>>,
    needed: &mut std::collections::HashSet<i64>,
    type_id: i64,
    name: String,
    base_quantity: i64,
    depth: u32,
    build: bool,
    ignore_build_groups: &[i64],
    path: &mut Vec<i64>,
) -> Result<InputLine, String> {
    needed.insert(type_id);
    // Always buy items in ignored groups (e.g. fuel blocks, RAMs) — matches
    // EVE-IPH's AlwaysBuyFuelBlocks/RAMs. The group ID comes from
    // invGroups.groupID via `sde.type_group`.
    let in_ignored_group = ignore_build_groups
        .iter()
        .any(|&g| sde.type_group(type_id).ok().flatten() == Some(g));
    let sourcing = if !build || depth == 0 || path.contains(&type_id) || in_ignored_group {
        Sourcing::Buy
    } else {
        let recipe = match cache.get(&type_id) {
            Some(r) => r.clone(),
            None => {
                let r = sde.recipe_for(type_id).map_err(|e| e.to_string())?;
                cache.insert(type_id, r.clone());
                r
            }
        };
        match recipe {
            Some(recipe) => {
                path.push(type_id);
                let mut inputs = Vec::with_capacity(recipe.materials.len());
                for m in &recipe.materials {
                    inputs.push(resolve_input(
                        sde,
                        cache,
                        needed,
                        m.material_type_id,
                        m.name.clone(),
                        m.quantity,
                        depth - 1,
                        build,
                        ignore_build_groups,
                        path,
                    )?);
                }
                path.pop();
                let activity = if recipe.activity_id == 11 {
                    Activity::Reaction
                } else {
                    Activity::Manufacturing
                };
                Sourcing::Build(Box::new(BuildStep {
                    activity,
                    blueprint_type_id: recipe.blueprint_type_id,
                    product_type_id: type_id,
                    product_name: name.clone(),
                    product_per_run: recipe.product_quantity,
                    inputs,
                    invention: None,
                    is_component: true, // All sub-builds in resolve_input are components
                }))
            }
            None => Sourcing::Buy,
        }
    };
    Ok(InputLine {
        type_id,
        name,
        base_quantity,
        sourcing,
    })
}

fn default_runs() -> i64 {
    1
}

/// Parameters for the production ranking. Everything here affects pricing/cost,
/// so changing one re-runs the calculation; the UI filters the results.
#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfitParams {
    /// Region to price against (default The Forge).
    #[serde(default = "default_region_id")]
    pub region_id: i64,
    /// Station within the region; `None` prices against the region average.
    #[serde(default)]
    pub station_id: Option<i64>,
    #[serde(default = "default_runs")]
    pub runs: i64,
    #[serde(default)]
    pub me: i64,
    /// Per-blueprint researched ME, keyed by blueprint type id, from the owned
    /// blueprint library. When a blueprint is owned, its real ME overrides the
    /// global `me` above (T2/T3 rows still use the invented BPC's ME). Empty by
    /// default; the UI populates it from the logged-in characters' blueprints.
    #[serde(default)]
    pub owned_me: HashMap<i64, i64>,
    #[serde(default)]
    pub system_cost_index: f64,
    #[serde(default)]
    pub facility_tax: f64,
    #[serde(default)]
    pub material_basis: Option<PriceBasis>,
    #[serde(default)]
    pub product_basis: Option<PriceBasis>,
    /// Amortized blueprint acquisition cost per run (e.g. a faction BPC).
    #[serde(default)]
    pub blueprint_cost_per_run: f64,
    /// Inventor science/encryption skill level (0..5) scaling invention
    /// probability. Default 5 (all V).
    #[serde(default)]
    pub invention_skill_level: Option<i64>,
    /// Decryptor type to apply to every T2 invention; `None` = no decryptor.
    #[serde(default)]
    pub decryptor_type_id: Option<i64>,
    /// Price the product at whichever hub pays the most (vs the chosen market).
    /// Materials are still priced at the chosen market.
    #[serde(default)]
    pub product_best_hub: bool,
    /// Time efficiency (default for un-owned blueprints), 0..20.
    #[serde(default)]
    pub te: i64,
    /// Per-blueprint researched TE (blueprintTypeId → TE) from the owned library.
    #[serde(default)]
    pub owned_te: HashMap<i64, i64>,
    /// Industry time-skill level (0..5): Industry −4%/lvl × Advanced Industry −3%/lvl.
    #[serde(default)]
    pub time_skill: i64,
    /// Structure time-efficiency bonus, percent (e.g. Raitaru 15, Sotiyo 30).
    #[serde(default)]
    pub structure_te_pct: f64,
    /// Combined structure+rig material multiplier (1.0 = none, 0.99 = −1%).
    #[serde(default = "default_me_bonus")]
    pub me_bonus: f64,
    /// Combined structure+rig cost saving on the cost-index portion (0..1).
    #[serde(default)]
    pub cost_bonus: f64,
    /// SCC surcharge fraction of EIV (CCP's 4% manufacturing default).
    #[serde(default = "default_scc")]
    pub scc_surcharge: f64,
    /// Owned stock per type id (from `roster_stock`); netted against the
    /// top-level bill of materials so you only buy the shortfall. Empty = none.
    #[serde(default)]
    pub stock: HashMap<i64, i64>,
    /// Build sub-components (recursive build-vs-buy). When false, every material
    /// is simply bought at market — no intermediate manufacturing. Default true.
    #[serde(default = "default_build_components")]
    pub build_components: bool,
    /// Subtract sale costs (broker fee + sales tax) from product revenue.
    #[serde(default)]
    pub include_sales_cost: bool,
    /// Sales tax fraction applied to revenue (when `include_sales_cost`).
    #[serde(default)]
    pub sales_tax: f64,
    /// Broker fee fraction applied to revenue (when `include_sales_cost`).
    #[serde(default)]
    pub broker_fee: f64,
    /// Facility profiles for manufacturing and reaction steps. When `Some`,
    /// each build step selects its profile by activity (via
    /// [`FacilityProfiles::for_activity`]); when `None`, the flat
    /// `me_bonus`/`cost_bonus`/`system_cost_index`/`facility_tax` fields are
    /// used as-is (backward compatibility with the old single-structure API).
    #[serde(default)]
    pub facility_profiles: Option<super::engine::FacilityProfiles>,
    /// Whether to ignore side products (reaction by-products) in the build vs.
    /// buy decision. When `true` (default), side products are not valued as
    /// additional revenue — only the main product's profit is computed.
    #[serde(default = "default_ignore_side_products")]
    #[allow(dead_code)]
    pub ignore_side_products: bool,
    /// Optional character implant/facility module bonuses (time, ME, cost).
    /// When `Some`, applied on top of the facility profile's bonuses.
    pub implant: Option<super::engine::ImplantBonus>,
    /// Fallback ME (0..=10) applied to **component** build steps
    /// (`BuildStep.is_component == true`) when the component's blueprint is not
    /// in `owned_me` — lets the user set ONE ME for all components. Ignored for
    /// the top-level product (which uses `me`). 0 = no bonus.
    #[serde(default)]
    pub component_me: i64,
    /// Fallback TE (0..=20) for component build steps when not owned — one value
    /// for all components. Ignored for the top-level product. 0 = no bonus.
    #[serde(default)]
    pub component_te: i64,
    /// Inventory group IDs whose materials are always bought (never built),
    /// even when `build_components` is on — matches EVE-IPH's
    /// `AlwaysBuyFuelBlocks`/`AlwaysBuyRAMs`: 1136 = Fuel Blocks, 332 = R.A.M.-ы.
    /// Empty = build normally (no forced buy).
    #[serde(default)]
    pub ignore_build_groups: Vec<i64>,
}

fn default_build_components() -> bool {
    true
}

fn default_me_bonus() -> f64 {
    1.0
}
fn default_scc() -> f64 {
    0.04
}

fn default_ignore_side_products() -> bool {
    true
}

/// Base material efficiency of a freshly invented T2 blueprint copy (no
/// decryptor). `pub(crate)` so Mass Production's Hypothetical mode (#893) can
/// default its T2-ME assumption to the same real EVE invention mechanic
/// instead of duplicating the constant.
pub(crate) const BASE_T2_ME: i64 = 2;

/// Rank **every** manufacturable item by build-vs-buy profit at the chosen
/// market. The whole catalogue is returned; the UI filters it client-side.
#[tauri::command]
#[specta::specta]
pub async fn production_profit(
    app: AppHandle,
    market: State<'_, MarketService>,
    params: ProfitParams,
) -> Result<Vec<ProfitBreakdown>, AppError> {
    let (dir, sde) = crate::sde::dir_and_sde(&app)?;

    // Saved lists are keyed by blueprint type id (the ranking row's identity):
    // blacklisted blueprints are dropped, favorites are flagged for the UI.
    let (blacklist, favorites) =
        lists::load_filter_sets(&dir, PRODUCTION_BLACKLIST_KEY, PRODUCTION_FAVORITES_KEY);

    // Resolve the chosen decryptor (if any) once up front.
    let decryptor = match params.decryptor_type_id {
        Some(id) => sde
            .decryptors()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|d| d.type_id == id),
        None => None,
    };

    // Build a manufacturing step for every manufacturable blueprint, collecting
    // the type ids we need prices for. Materials and invention data are
    // fetched once for the whole catalogue up front (#765) — the loop below
    // no longer issues a per-blueprint SDE query.
    let all_materials = sde.all_blueprint_materials().map_err(|e| e.to_string())?;
    let all_invention = sde.all_invention_products().map_err(|e| e.to_string())?;
    let mut steps = Vec::new();
    let mut needed = std::collections::HashSet::new();
    let mut recipe_cache: HashMap<i64, Option<Recipe>> = HashMap::new();
    for bp in sde.manufacturable_blueprints().map_err(|e| e.to_string())? {
        if blacklist.contains(&bp.blueprint_type_id) {
            continue;
        }
        let product = crate::sde::BlueprintProduct {
            product_type_id: bp.product_type_id,
            name: bp.product_name,
            quantity: bp.product_quantity,
        };
        let materials = all_materials
            .get(&bp.blueprint_type_id)
            .cloned()
            .unwrap_or_default();
        needed.insert(product.product_type_id);

        let mut step = manufacturing_step(bp.blueprint_type_id, &product, &materials);
        // Recursively resolve each material into a build-or-buy sub-tree.
        let mut path = vec![product.product_type_id];
        let mut inputs = Vec::with_capacity(materials.len());
        for m in &materials {
            inputs.push(resolve_input(
                &sde,
                &mut recipe_cache,
                &mut needed,
                m.material_type_id,
                m.name.clone(),
                m.quantity,
                MAX_TREE_DEPTH,
                params.build_components,
                &params.ignore_build_groups,
                &mut path,
            )?);
        }
        step.inputs = inputs;
        // T2 items: attach the invention so its expected cost is amortized in.
        if let Some(inv) = all_invention.get(&bp.blueprint_type_id) {
            // A missing industryActivityProbabilities row is an SDE data gap,
            // not a legitimate 0% invention chance (downstream cost math
            // divides by probability * runs_per_success). Skip this
            // blueprint out of the ranking entirely rather than rank it
            // with a fabricated probability (#811).
            let Some(base_probability) = inv.probability else {
                continue;
            };
            // T1 product's manufacturing materials estimate the copy job fee.
            let copy_materials = all_materials
                .get(&inv.inventing_blueprint_type_id)
                .cloned()
                .unwrap_or_default();
            needed.extend(inv.datacores.iter().map(|d| d.material_type_id));
            needed.extend(copy_materials.iter().map(|m| m.material_type_id));
            let to_input = |m: &crate::sde::BlueprintMaterial| InputLine {
                type_id: m.material_type_id,
                name: m.name.clone(),
                base_quantity: m.quantity,
                sourcing: Sourcing::Buy,
            };
            // A decryptor shifts ME/runs/probability and is consumed per attempt.
            let mut datacores: Vec<InputLine> = inv.datacores.iter().map(to_input).collect();
            // T3 invention consumes an Ancient Relic bought at market; price it in
            // as a per-attempt input (it has no copy fee — relics aren't copied).
            if let Some(relic) = &inv.relic {
                needed.insert(relic.material_type_id);
                datacores.push(to_input(relic));
            }
            let (result_me, runs_per_success, probability) = match &decryptor {
                Some(d) => {
                    needed.insert(d.type_id);
                    datacores.push(InputLine {
                        type_id: d.type_id,
                        name: d.name.clone(),
                        base_quantity: 1,
                        sourcing: Sourcing::Buy,
                    });
                    (
                        BASE_T2_ME + d.me_modifier,
                        inv.runs_per_success + d.run_modifier,
                        base_probability * d.probability_multiplier,
                    )
                }
                None => (BASE_T2_ME, inv.runs_per_success, base_probability),
            };
            step.invention = Some(Invention {
                datacores,
                copy_materials: copy_materials.iter().map(to_input).collect(),
                runs_per_success,
                probability,
                result_me,
                base_blueprint_type_id: inv.inventing_blueprint_type_id,
            });
        }
        steps.push(step);
    }
    let ids: Vec<i64> = needed.into_iter().collect();

    // Price everything at the chosen location (Fuzzwork aggregates + ESI adjusted).
    let location = resolve_location(params.region_id, params.station_id);
    let market_name = location_label(params.region_id, params.station_id);
    let prices = market
        .price_map_at(location, &ids)
        .await
        .map_err(|e| e.to_string())?;

    // Invention probability multiplier from skills (1 + L/40 + 2L/30); all-V ≈ 1.458.
    let skill = params.invention_skill_level.unwrap_or(5).clamp(0, 5) as f64;
    let invention_skill_multiplier = 1.0 + skill / 40.0 + 2.0 * skill / 30.0;
    let config = ProfitConfig {
        system_cost_index: params.system_cost_index,
        facility_tax: params.facility_tax,
        material_basis: params.material_basis.unwrap_or(PriceBasis::SellPercentile),
        product_basis: params.product_basis.unwrap_or(PriceBasis::SellPercentile),
        blueprint_cost_per_run: params.blueprint_cost_per_run,
        invention_skill_multiplier,
        me_bonus: params.me_bonus,
        cost_bonus: params.cost_bonus,
        structure_te_pct: params.structure_te_pct,
        role_bonus_time: params
            .facility_profiles
            .as_ref()
            .map(|p| p.reaction.role_bonus_time)
            .unwrap_or(0.0),
        scc_surcharge: params.scc_surcharge,
        include_sales_cost: params.include_sales_cost,
        sales_tax: params.sales_tax,
        broker_fee: params.broker_fee,
        facility_profiles: params.facility_profiles.clone(),
        implant: params.implant.clone(),
        owned_me: params.owned_me.clone(),
        owned_te: params.owned_te.clone(),
        component_me: params.component_me,
    };

    let meta = crate::sde::cached_meta_group_names(&dir)?;
    let categories = crate::sde::cached_category_names(&dir)?;
    let groups = crate::sde::cached_group_names(&dir)?;
    let base_times = sde.base_times(1).map_err(|e| e.to_string())?; // 1 = manufacturing
    let base_times_rxn = sde.base_times(11).map_err(|e| e.to_string())?; // 11 = reaction
                                                                         // Names for the T1 (or T3 relic) blueprint each T2/T3 row is invented
                                                                         // from, so the UI can show what a "build" actually starts from.
    let base_bp_ids: Vec<i64> = steps
        .iter()
        .filter_map(|s| s.invention.as_ref().map(|i| i.base_blueprint_type_id))
        .collect();
    let base_bp_names: HashMap<i64, String> = sde
        .type_names(&base_bp_ids)
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect();

    // Job-time multipliers shared by every row: Industry (−4%/lvl) × Advanced
    // Industry (−3%/lvl) × structure TE bonus.
    let l = params.time_skill.clamp(0, 5) as f64;
    let time_skill_mult = (1.0 - 0.04 * l) * (1.0 - 0.03 * l);
    // Profile-aware TE bonus: from the facility profile if configured, else
    // the flat `structure_te_pct` (backward compat). Uses the manufacturing
    // profile (top-level product is never a component).
    let mfg_te_bonus_pct = config.te_bonus_pct_for(super::engine::Activity::Manufacturing);
    let mfg_te_mult = 1.0 - mfg_te_bonus_pct / 100.0;

    // Walk a build tree and sum the reaction-job time (seconds) for all
    // Reaction sub-steps. Reactions get no Industry-skill bonus, but do get
    // the reaction facility's TE bonus and role-bonus time (Tatara −25%).
    fn reaction_time_for_step(
        step: &BuildStep,
        base_times_rxn: &HashMap<i64, i64>,
        params: &ProfitParams,
        config: &ProfitConfig,
        runs: i64,
        depth: u32,
    ) -> f64 {
        if depth == 0 {
            return 0.0;
        }
        let mut total = 0.0;
        if step.activity == super::engine::Activity::Reaction {
            if let Some(&base) = base_times_rxn.get(&step.blueprint_type_id) {
                let te = params
                    .owned_te
                    .get(&step.blueprint_type_id)
                    .copied()
                    .unwrap_or(params.te);
                let te_bonus = config.te_bonus_pct_for_step(step);
                let role_bonus = config.role_bonus_time_for_step(step);
                // Reaction time = base × runs × (1 − blueprint_TE) × (1 − facility_TE) × (1 − role_bonus)
                total += base as f64
                    * runs as f64
                    * (1.0 - te as f64 / 100.0)
                    * (1.0 - te_bonus / 100.0)
                    * (1.0 - role_bonus);
            }
        }
        for input in &step.inputs {
            if let Sourcing::Build(sub) = &input.sourcing {
                total +=
                    reaction_time_for_step(sub, base_times_rxn, params, config, runs, depth - 1);
            }
        }
        total
    }

    let mut out: Vec<ProfitBreakdown> = steps
        .iter()
        .map(|step| {
            // Owned blueprints use their researched ME; everything else the global
            // ME slider. But for COMPONENT build steps (is_component), fall back
            // to the shared `component_me` (one ME for all components) instead —
            // T2/T3 rows still override with the invented BPC's ME in evaluate.
            let step_me = if step.is_component {
                params
                    .owned_me
                    .get(&step.blueprint_type_id)
                    .copied()
                    .unwrap_or(params.component_me)
            } else {
                params
                    .owned_me
                    .get(&step.blueprint_type_id)
                    .copied()
                    .unwrap_or(params.me)
            };
            let mut bd = evaluate_with_stock(
                step,
                params.runs,
                step_me,
                prices.as_map(),
                &config,
                &params.stock,
            );
            // Manufacturing job time = base × runs × (1 − TE/100) × skill × facility_TE.
            // Components use the shared `component_te` fallback — one TE for all.
            let te = if step.is_component {
                params
                    .owned_te
                    .get(&step.blueprint_type_id)
                    .copied()
                    .unwrap_or(params.component_te)
            } else {
                params
                    .owned_te
                    .get(&step.blueprint_type_id)
                    .copied()
                    .unwrap_or(params.te)
            };
            if let Some(&base) = base_times.get(&step.blueprint_type_id) {
                let time = base as f64
                    * params.runs as f64
                    * (1.0 - te as f64 / 100.0)
                    * time_skill_mult
                    * mfg_te_mult;
                bd.job_time_seconds = time;
                bd.manufacturing_time_seconds = time;
            }
            // Reaction sub-build time (walk the tree).
            bd.reaction_time_seconds = reaction_time_for_step(
                step,
                &base_times_rxn,
                &params,
                &config,
                params.runs,
                MAX_TREE_DEPTH,
            );
            bd.meta_group = Some(
                meta.get(&bd.product_type_id)
                    .cloned()
                    .unwrap_or_else(|| "Tech I".to_string()),
            );
            bd.category = categories.get(&bd.product_type_id).cloned();
            bd.group = groups.get(&bd.product_type_id).cloned();
            if let Some(inv) = bd.invention.as_mut() {
                inv.base_blueprint_name = base_bp_names
                    .get(&inv.base_blueprint_type_id)
                    .cloned()
                    .unwrap_or_default();
            }
            bd.market = Some(market_name.clone());
            bd.favorite = favorites.contains(&bd.blueprint_type_id);
            bd
        })
        .collect();

    // "Sell at best hub": re-price each product at whichever hub pays the most
    // and recompute the profit fields. Materials stay at the chosen market.
    if params.product_best_hub {
        let product_ids: Vec<i64> = out.iter().map(|r| r.product_type_id).collect();
        let best = market
            .best_sell_hubs(&product_ids)
            .await
            .map_err(|e| e.to_string())?;
        // Same revenue basis the engine used, so repriced and untouched rows
        // stay comparable.
        let sales_cost = if params.include_sales_cost {
            params.sales_tax + params.broker_fee
        } else {
            0.0
        };
        for bd in &mut out {
            if let Some(b) = best.get(&bd.product_type_id) {
                if b.price > bd.product_price.unwrap_or(0.0) {
                    reprice_product(bd, b.price, &b.hub, sales_cost);
                }
            }
        }
    }

    out.sort_by(|a, b| {
        b.profit
            .partial_cmp(&a.profit)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

/// Re-price a breakdown's product at `unit_price` (the best hub's sell price)
/// and recompute the dependent profit fields. `sales_cost` is the combined
/// sales-tax + broker-fee fraction taken off revenue (0.0 when the caller
/// values revenue gross) — it must match the basis the engine used, or
/// repriced rows would not be comparable with the rest. Cost is unchanged.
/// Pure (testable).
fn reprice_product(bd: &mut ProfitBreakdown, unit_price: f64, hub: &str, sales_cost: f64) {
    let cost = bd.material_cost + bd.job_fee + bd.blueprint_cost + bd.invention_cost;
    bd.product_price = Some(unit_price);
    bd.revenue = bd.units_produced as f64 * unit_price * (1.0 - sales_cost);
    bd.profit = bd.revenue - cost;
    bd.margin = (bd.revenue > 0.0).then(|| bd.profit / bd.revenue);
    bd.roi = (cost > 0.0).then(|| bd.profit / cost);
    bd.profit_per_unit = if bd.units_produced > 0 {
        bd.profit / bd.units_produced as f64
    } else {
        0.0
    };
    bd.sell_hub = Some(hub.to_string());
}

/// The invention decryptors (for the UI dropdown).
#[tauri::command]
#[specta::specta]
pub async fn production_decryptors(app: AppHandle) -> Result<Vec<crate::sde::Decryptor>, AppError> {
    let sde = crate::sde::open_from_app(&app)?;
    sde.decryptors().map_err(|e| AppError::from(e.to_string()))
}

/// Storage keys for production's saved lists — distinct from trading's so the
/// two modules' blacklists/favorites never collide.
const PRODUCTION_BLACKLIST_KEY: &str = "production_blacklist";
const PRODUCTION_FAVORITES_KEY: &str = "production_favorites";

/// Map the UI's logical list name to its (module-scoped) storage key.
fn list_key(list: &str) -> Result<&'static str, String> {
    match list {
        "blacklist" => Ok(PRODUCTION_BLACKLIST_KEY),
        "favorites" => Ok(PRODUCTION_FAVORITES_KEY),
        _ => Err(format!("unknown list: {list}")),
    }
}

/// The contents of a production saved list (`blacklist` or `favorites`), with
/// names. Ids are blueprint type ids.
#[tauri::command]
#[specta::specta]
pub fn production_get_list(app: AppHandle, list: String) -> Result<Vec<ListItem>, AppError> {
    let key = list_key(&list)?;
    lists::get_from_app(&app, key).map_err(Into::into)
}

/// Add or remove a blueprint type from a production saved list.
#[tauri::command]
#[specta::specta]
pub fn production_set_list(
    app: AppHandle,
    list: String,
    type_id: i64,
    add: bool,
) -> Result<(), AppError> {
    let key = list_key(&list)?;
    lists::set_from_app(&app, key, type_id, add).map_err(Into::into)
}

// --- Rig bonus computation (from well-known rig type IDs) ---

/// A known manufacturing rig type with its bonus description.
/// A rig type surfaced to the Facilities rig selector.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RigTypeInfo {
    pub type_id: i64,
    pub name: String,
    /// `me` / `te` / `cost` — primary bonus column (groups the multiselect).
    pub category: String,
    pub tier: String,
    /// Primary base bonus (display, %, 100% scale).
    pub bonus: f64,
    /// Rig slot size: 1=Small, 2=Medium, 3=Large, 4=XL. A rig only fits a slot
    /// of its own size, so the UI only offers rigs with `rig_size ==
    /// structure.max_rig_size`.
    pub rig_size: i64,
    /// Base (100%) reductions, in %: material / time / cost.
    pub me_bonus: f64,
    pub te_bonus: f64,
    pub cost_bonus: f64,
    pub is_t2: bool,
}

/// All industry rigs for one facility type, readable right now. Rigs are
/// filtered to those whose slot size exactly matches `max_rig_size` (the size
/// of the slot the chosen structure exposes — a rig only fits a slot of its
/// own size). `"reaction"` → refinery/reactor rigs (`RefRig*` dogma attrs,
/// reduce reactant usage & reaction time); `"manufacturing"`/`"components"` →
/// engineering rigs (`EngRig*` attrs). Bonuses are the base (un-scaled)
/// percentages; [`production_rig_bonuses`] security-scales them on selection.
#[tauri::command]
#[specta::specta]
pub fn production_rigs(
    app: tauri::AppHandle,
    facility_type: super::engine::FacilityType,
    max_rig_size: i64,
) -> Result<Vec<RigTypeInfo>, AppError> {
    let sde = crate::sde::open_from_app(&app)?;
    let group_prefix = match facility_type {
        super::engine::FacilityType::Reaction => "Reactor Rig",
        super::engine::FacilityType::Manufacturing | super::engine::FacilityType::Components => {
            "Engineering Rig"
        }
    };
    let rigs = sde
        .industry_rigs(group_prefix, max_rig_size)
        .map_err(|e| e.to_string())?;
    Ok(rigs
        .into_iter()
        .map(|r| {
            // Base (100%) reductions as absolute % — a rig is either refinery
            // (RefRig*) or engineering (EngRig*); only one family is non-zero.
            let me = r.ref_mat.abs() + r.eng_mat.abs();
            let te = r.ref_time.abs() + r.eng_time.abs();
            let cost = r.eng_cost.abs();
            let (category, bonus) = if me > 0.0 {
                ("me", me)
            } else if te > 0.0 {
                ("te", te)
            } else {
                ("cost", cost)
            };
            RigTypeInfo {
                type_id: r.type_id,
                name: r.name,
                category: category.to_string(),
                tier: if r.tech_level >= 2.0 { "T2" } else { "T1" }.to_string(),
                bonus,
                rig_size: r.rig_size,
                me_bonus: me,
                te_bonus: te,
                cost_bonus: cost,
                is_t2: r.tech_level >= 2.0,
            }
        })
        .collect())
}

/// Base + security-scaled bonus for a single Standup rig, read from its SDE
/// dogma attributes (those not in the legacy 1955-1978 table). Returns
/// `(mePct, tePct, costPct)` — absolute reduction percentages. `None` when the
/// type isn't an industry rig.
fn sde_rig_bonus(
    sde: &Sde,
    type_id: i64,
    security_tier: super::engine::SecurityTier,
) -> Option<(f64, f64, f64)> {
    let attrs = sde.type_attributes_raw(type_id).ok()?;
    rig_bonus_from_attrs(&attrs, security_tier)
}

/// Pure core of [`sde_rig_bonus`]: map a rig's dogma attribute bag to its
/// base + security-scaled `(mePct, tePct, costPct)`. Returns `None` when the
/// type carries no industry-rig bonus attributes (i.e. it isn't a Standup
/// industry rig). Factored out so the refinery/engineering rig math is
/// unit-testable without a full SDE connection.
fn rig_bonus_from_attrs(
    attrs: &[(i64, f64)],
    security_tier: super::engine::SecurityTier,
) -> Option<(f64, f64, f64)> {
    let a = |id: i64| -> f64 {
        attrs
            .iter()
            .find(|(k, _)| *k == id)
            .map(|(_, v)| *v)
            .unwrap_or(0.0)
    };
    // Refinery reactor rigs: RefRigMatBonus(2714)/RefRigTimeBonus(2713).
    // Engineering rigs: EngRigMatBonus(2594)/EngRigTimeBonus(2593)/EngRigCostBonus(2595).
    let me = (-a(2714)) + (-a(2594));
    let te = (-a(2713)) + (-a(2593));
    let cost = -a(2595);
    if me == 0.0 && te == 0.0 && cost == 0.0 {
        return None;
    }
    let mult = rig_security_multiplier(attrs, security_tier);
    Some((me * mult, te * mult, cost * mult))
}

/// Security-tier effectiveness multiplier for a Standup rig, read from the rig's
/// own dogma attributes (`hiSecModifier`/`lowSecModifier`/`nullSecModifier`,
/// ids 2355-2357) — NOT the legacy `t2_rig_security_multiplier` (which applies
/// only to the 1955-1978 rigs). `disallowInHighSec` (1970) → 0 in highsec.
/// Wormhole is treated as nullsec (security ≈ 0), matching the user-verified
/// refinery-rig behaviour (low/null/wh = 1.0/1.1/1.1). Absent attrs → 1.0.
fn rig_security_multiplier(
    attrs: &[(i64, f64)],
    security_tier: super::engine::SecurityTier,
) -> f64 {
    let a = |id: i64| -> f64 {
        attrs
            .iter()
            .find(|(k, _)| *k == id)
            .map(|(_, v)| *v)
            .unwrap_or(1.0)
    };
    let disallow_highsec = attrs.iter().any(|(k, v)| *k == 1970 && *v != 0.0);
    match security_tier {
        super::engine::SecurityTier::Highsec => {
            if disallow_highsec {
                0.0
            } else {
                a(2355)
            }
        }
        super::engine::SecurityTier::Lowsec => a(2356),
        super::engine::SecurityTier::Nullsec => a(2357),
        super::engine::SecurityTier::Wormhole => a(2357),
    }
}

/// Resolve selected rig type IDs + facility security tier into
/// `(meBonus, teBonusPct, costBonusPct)` — same contract as the engine's
/// `rig_bonuses_from_ids`. Legacy rigs (1955-1978) use the built-in bonus
/// table; any other Standup rig has its bonus read from the SDE dogma attrs
/// and security-scaled by the rig's own modifiers (see [`sde_rig_bonus`]).
#[tauri::command]
#[specta::specta]
pub fn production_rig_bonuses(
    app: tauri::AppHandle,
    rig_type_ids: Vec<i64>,
    security_tier: super::engine::SecurityTier,
) -> Result<(f64, f64, f64), AppError> {
    // Standup rigs need the SDE. If it isn't installed yet, fall back to the
    // legacy table only (new rigs → no bonus). The app requires the SDE for
    // any real calculation, so this only fires before first run.
    let sde = crate::sde::open_from_app(&app).ok();
    let mut me_pct = 0.0_f64;
    let mut te_pct = 0.0_f64;
    let mut cost_pct = 0.0_f64;
    for id in &rig_type_ids {
        if let Some(b) = super::engine::rig_bonus_lookup(*id) {
            // Legacy rigs: T2 rigs scale by the classic security multiplier.
            let mult = if b.is_t2 {
                super::engine::t2_rig_security_multiplier(security_tier)
            } else {
                1.0
            };
            me_pct += b.me_pct * mult;
            te_pct += b.te_pct * mult;
            cost_pct += b.cost_pct * mult;
        } else if let Some((m, t, c)) = sde
            .as_ref()
            .and_then(|s| sde_rig_bonus(s, *id, security_tier))
        {
            me_pct += m;
            te_pct += t;
            cost_pct += c;
        }
        // Unknown id → no bonus, preserving prior behaviour.
    }
    Ok((1.0 - me_pct / 100.0, te_pct, cost_pct))
}

// --- Live per-system industry cost index (ESI /industry/systems/) ---

#[derive(Deserialize)]
struct EsiIndustrySystem {
    solar_system_id: i64,
    cost_indices: Vec<EsiCostIndex>,
}
#[derive(Deserialize)]
struct EsiCostIndex {
    activity: String,
    cost_index: f64,
}

/// Max staleness accepted for the on-disk cost-index map when a live ESI
/// refresh fails: 24h past expiry. Cost indices drift slowly, so a day-old
/// map beats erroring out (#774).
const COST_INDEX_MAX_STALE_SECS: u64 = 24 * 3600;

/// Single-flight guard for the on-disk industry-cost-index cache read,
/// mirroring the per-cache `KeyLocks` fields in `market::service`. Managed
/// as its own Tauri state since production has no `MarketService`-like
/// struct of its own to hold it (#888).
#[derive(Default)]
pub struct CostIndexLocks(KeyLocks<()>);

/// The **manufacturing** cost index CCP applies to job fees in a solar system,
/// from ESI `/industry/systems/` (public). The full list is fetched once and
/// cached ~1h on disk, then looked up per system. `None` when the system isn't
/// listed (e.g. wormhole space). Lets the production tab use the real index
/// instead of a hand-entered guess. When the refresh fails but a map ≤24h past
/// expiry sits on disk, the stale map is served instead of an error via the
/// shared [`deduplicated_cached_fetch_with_stale_fallback`] helper (#774, #888).
#[tauri::command]
#[specta::specta]
pub async fn production_system_cost_index(
    app: AppHandle,
    esi: State<'_, EsiClient>,
    locks: State<'_, CostIndexLocks>,
    system_id: i64,
) -> Result<Option<f64>, AppError> {
    let dir = crate::storage::app_data_dir(&app)?;
    let map: HashMap<i64, f64> = deduplicated_cached_fetch_with_stale_fallback(
        &locks.0,
        &(),
        || storage::cache_get(&dir, "industry_cost_indices"),
        || async {
            let systems: Vec<EsiIndustrySystem> = esi
                .get_json("/latest/industry/systems/", &[])
                .await
                .map_err(|e| e.to_string())?;
            let map: HashMap<i64, f64> = systems
                .into_iter()
                .filter_map(|s| {
                    s.cost_indices
                        .iter()
                        .find(|c| c.activity == "manufacturing")
                        .map(|c| (s.solar_system_id, c.cost_index))
                })
                .collect();
            let _ = storage::cache_put(&dir, "industry_cost_indices", &map, 3600);
            Ok::<_, String>(map)
        },
        || storage::cache_get_stale(&dir, "industry_cost_indices", COST_INDEX_MAX_STALE_SECS),
    )
    .await?;
    Ok(map.get(&system_id).copied())
}

/// The raw SDE solar-system security (−1.0 … +1.0) for the system an NPC
/// station sits in, resolved via `staStations → mapSolarSystems`. `None` when
/// the station isn't in `staStations` (e.g. an Upwell structure) or the
/// system is unknown — the caller falls back to region-based detection for
/// WH space.
#[tauri::command]
#[specta::specta]
pub fn production_station_security(
    app: AppHandle,
    station_id: i64,
) -> Result<Option<f64>, AppError> {
    if station_id <= 0 {
        return Ok(None);
    }
    let sde = crate::sde::open_from_app(&app)?;
    if let Some((system_id, _)) = sde
        .station_location(station_id)
        .map_err(|e| e.to_string())?
    {
        if let Some(info) = sde.system_info(system_id).map_err(|e| e.to_string())? {
            return Ok(Some(info.security));
        }
    }
    Ok(None)
}

/// Collects this module's specta-annotated commands for [`crate::bindings`].
pub fn specta_commands() -> tauri_specta::Commands<tauri::Wry> {
    tauri_specta::collect_commands![
        production_profit,
        production_decryptors,
        production_get_list,
        production_set_list,
        production_system_cost_index,
        production_station_security,
        production_rigs,
        production_rig_bonuses,
    ]
}

#[cfg(test)]
mod cost_index_fallback_tests {
    use super::*;

    /// Expired-but-recoverable cache + failing ESI → the stale map is served
    /// (moved/adapted onto the generalized helper for #888; was a pure test
    /// of the bespoke `cost_index_fallback` before #774's pattern generalized).
    #[test]
    fn stale_map_beats_fetch_error() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("runtime");
        rt.block_on(async {
            let locks = KeyLocks::<()>::new();
            let stale: HashMap<i64, f64> = [(30000142, 0.041)].into();
            let got = deduplicated_cached_fetch_with_stale_fallback(
                &locks,
                &(),
                || None,
                || async { Err::<HashMap<i64, f64>, String>("esi down".into()) },
                || Some(stale.clone()),
            )
            .await;
            assert_eq!(got.unwrap(), stale);
        });
    }

    /// No usable cache + failing ESI → the fetch error surfaces unchanged.
    #[test]
    fn no_cache_surfaces_the_error() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("runtime");
        rt.block_on(async {
            let locks = KeyLocks::<()>::new();
            let got = deduplicated_cached_fetch_with_stale_fallback(
                &locks,
                &(),
                || None,
                || async { Err::<HashMap<i64, f64>, String>("esi down".into()) },
                || None,
            )
            .await;
            assert_eq!(got.unwrap_err(), "esi down");
        });
    }
}

#[cfg(test)]
mod resolve_input_tests {
    use std::collections::HashSet;

    use crate::sde::test_sde;

    use super::*;

    /// A↔B cycle: blueprint 11 (product A=10) needs 1x B=20; blueprint 21
    /// (product B=20) needs 1x A=10.
    fn cycle_sde() -> Sde {
        test_sde(
            "CREATE TABLE invTypes(typeID INT, typeName TEXT);
             INSERT INTO invTypes VALUES (10, 'A'), (20, 'B');
             CREATE TABLE industryActivityProducts(typeID INT, activityID INT, productTypeID INT, quantity INT);
             CREATE TABLE industryActivityMaterials(typeID INT, activityID INT, materialTypeID INT, quantity INT);
             INSERT INTO industryActivityProducts VALUES (11, 1, 10, 1), (21, 1, 20, 1);
             INSERT INTO industryActivityMaterials VALUES (11, 1, 20, 1), (21, 1, 10, 1);",
        )
    }

    /// A straight-line chain A=10 -> B=20 -> C=30, where C is a raw material
    /// with no recipe of its own (a genuine Buy leaf).
    fn chain_sde() -> Sde {
        test_sde(
            "CREATE TABLE invTypes(typeID INT, typeName TEXT);
             INSERT INTO invTypes VALUES (10, 'A'), (20, 'B'), (30, 'C');
             CREATE TABLE industryActivityProducts(typeID INT, activityID INT, productTypeID INT, quantity INT);
             CREATE TABLE industryActivityMaterials(typeID INT, activityID INT, materialTypeID INT, quantity INT);
             INSERT INTO industryActivityProducts VALUES (11, 1, 10, 1), (21, 1, 20, 1);
             INSERT INTO industryActivityMaterials VALUES (11, 1, 20, 1), (21, 1, 30, 1);",
        )
    }

    /// Reaction formula 500 (activityID 11) makes 100x Composite (600) from
    /// 50x Tritanium (200, a Buy leaf).
    fn reaction_sde() -> Sde {
        test_sde(
            "CREATE TABLE invTypes(typeID INT, typeName TEXT);
             INSERT INTO invTypes VALUES (200, 'Tritanium'), (600, 'Composite');
             CREATE TABLE industryActivityProducts(typeID INT, activityID INT, productTypeID INT, quantity INT);
             CREATE TABLE industryActivityMaterials(typeID INT, activityID INT, materialTypeID INT, quantity INT);
             INSERT INTO industryActivityProducts VALUES (500, 11, 600, 100);
             INSERT INTO industryActivityMaterials VALUES (500, 11, 200, 50);",
        )
    }

    fn build_step(line: &InputLine) -> &BuildStep {
        match &line.sourcing {
            Sourcing::Build(step) => step,
            Sourcing::Buy => panic!("expected {} to be Build, got Buy", line.type_id),
        }
    }

    fn assert_buy(line: &InputLine) {
        assert!(
            matches!(line.sourcing, Sourcing::Buy),
            "expected {} to be Buy",
            line.type_id
        );
    }

    #[test]
    fn cycle_terminates_with_inner_recurrence_bought() {
        let sde = cycle_sde();
        let mut cache = HashMap::new();
        let mut needed = HashSet::new();
        let mut path = Vec::new();

        let root = resolve_input(
            &sde,
            &mut cache,
            &mut needed,
            10,
            "A".to_string(),
            1,
            MAX_TREE_DEPTH,
            true,
            &[],
            &mut path,
        )
        .unwrap();

        // A builds from B, B builds from A -- but the second occurrence of A
        // (closing the cycle) must be bought, not recursed into again.
        let a_step = build_step(&root);
        assert_eq!(a_step.inputs.len(), 1);
        let b_line = &a_step.inputs[0];
        assert_eq!(b_line.type_id, 20);
        let b_step = build_step(b_line);
        assert_eq!(b_step.inputs.len(), 1);
        let inner_a = &b_step.inputs[0];
        assert_eq!(inner_a.type_id, 10);
        assert_buy(inner_a);
        // `path` is restored to empty once the top-level call returns.
        assert!(path.is_empty());
    }

    #[test]
    fn zero_depth_buys_without_touching_the_recipe_cache() {
        let sde = chain_sde();
        let mut cache = HashMap::new();
        let mut needed = HashSet::new();
        let mut path = Vec::new();

        let line = resolve_input(
            &sde,
            &mut cache,
            &mut needed,
            10,
            "A".to_string(),
            1,
            0,
            true,
            &[],
            &mut path,
        )
        .unwrap();

        assert_buy(&line);
        assert!(cache.is_empty(), "depth 0 must never consult recipe_for");
    }

    #[test]
    fn build_false_buys_without_touching_the_recipe_cache() {
        let sde = chain_sde();
        let mut cache = HashMap::new();
        let mut needed = HashSet::new();
        let mut path = Vec::new();

        let line = resolve_input(
            &sde,
            &mut cache,
            &mut needed,
            10,
            "A".to_string(),
            1,
            MAX_TREE_DEPTH,
            false,
            &[],
            &mut path,
        )
        .unwrap();

        assert_buy(&line);
        assert!(
            cache.is_empty(),
            "build=false must never consult recipe_for"
        );
    }

    #[test]
    fn depth_one_builds_the_root_but_buys_its_direct_input() {
        let sde = chain_sde();
        let mut cache = HashMap::new();
        let mut needed = HashSet::new();
        let mut path = Vec::new();

        let root = resolve_input(
            &sde,
            &mut cache,
            &mut needed,
            10,
            "A".to_string(),
            1,
            1,
            true,
            &[],
            &mut path,
        )
        .unwrap();

        let a_step = build_step(&root);
        assert_eq!(a_step.inputs.len(), 1);
        // B (A's direct input) is bought: depth 1 -> B is resolved at depth 0.
        assert_buy(&a_step.inputs[0]);
        assert_eq!(a_step.inputs[0].type_id, 20);
        // C is never reached, so its recipe (if any) is never even looked up.
        assert_eq!(cache.len(), 1);
        assert!(cache.contains_key(&10));
    }

    #[test]
    fn reaction_activity_carries_formula_blueprint_and_product_quantity() {
        let sde = reaction_sde();
        let mut cache = HashMap::new();
        let mut needed = HashSet::new();
        let mut path = Vec::new();

        let line = resolve_input(
            &sde,
            &mut cache,
            &mut needed,
            600,
            "Composite".to_string(),
            50,
            MAX_TREE_DEPTH,
            true,
            &[],
            &mut path,
        )
        .unwrap();

        let step = build_step(&line);
        assert_eq!(step.activity, Activity::Reaction);
        assert_eq!(step.blueprint_type_id, 500);
        assert_eq!(step.product_type_id, 600);
        assert_eq!(step.product_per_run, 100);
        assert_eq!(step.inputs.len(), 1);
        assert_eq!(step.inputs[0].type_id, 200);
        assert_buy(&step.inputs[0]);
    }

    #[test]
    fn needed_set_covers_the_whole_resolved_tree() {
        let sde = chain_sde();
        let mut cache = HashMap::new();
        let mut needed = HashSet::new();
        let mut path = Vec::new();

        resolve_input(
            &sde,
            &mut cache,
            &mut needed,
            10,
            "A".to_string(),
            1,
            MAX_TREE_DEPTH,
            true,
            &[],
            &mut path,
        )
        .unwrap();

        // Root (built) + B (built) + C (bought leaf) must all be present, or
        // downstream pricing silently drops whichever id is missing.
        assert_eq!(needed, HashSet::from([10, 20, 30]));
    }
}

#[cfg(test)]
mod reprice_tests {
    use super::*;

    /// A 10-unit row costing 100 ISK total, currently priced at 20/unit.
    fn breakdown() -> ProfitBreakdown {
        ProfitBreakdown {
            blueprint_type_id: 1,
            product_type_id: 2,
            product_name: "Widget".into(),
            runs: 1,
            me: 0,
            materials: Vec::new(),
            job_time_seconds: 0.0,
            units_produced: 10,
            material_cost: 60.0,
            job_fee: 40.0,
            manufacturing_cost_index: 0.0,
            manufacturing_install_cost: 40.0,
            manufacturing_time_seconds: 0.0,
            reaction_install_cost: 0.0,
            reaction_time_seconds: 0.0,
            approximate: false,
            blueprint_cost: 0.0,
            invention_cost: 0.0,
            invention: None,
            product_price: Some(20.0),
            revenue: 200.0,
            profit: 100.0,
            margin: Some(0.5),
            roi: Some(1.0),
            profit_per_unit: 10.0,
            excess_revenue: 0.0,
            meta_group: None,
            category: None,
            group: None,
            market: None,
            sell_hub: None,
            favorite: false,
            product_volume: None,
            missing_prices: Vec::new(),
        }
    }

    #[test]
    fn reprices_gross_when_sales_costs_are_off() {
        let mut bd = breakdown();
        reprice_product(&mut bd, 30.0, "Jita", 0.0);
        assert_eq!(bd.product_price, Some(30.0));
        assert_eq!(bd.revenue, 300.0);
        assert_eq!(bd.profit, 200.0); // 300 − 100 cost
        assert_eq!(bd.margin, Some(200.0 / 300.0));
        assert_eq!(bd.roi, Some(2.0));
        assert_eq!(bd.profit_per_unit, 20.0);
        assert_eq!(bd.sell_hub.as_deref(), Some("Jita"));
    }

    #[test]
    fn applies_the_engines_sales_cost_basis() {
        // 8% off revenue must land on the repriced row too, or a best-hub row
        // would be compared against net-revenue rows on a gross basis.
        let mut bd = breakdown();
        reprice_product(&mut bd, 30.0, "Amarr", 0.08);
        assert_eq!(bd.revenue, 300.0 * 0.92);
        assert_eq!(bd.profit, 300.0 * 0.92 - 100.0);
    }

    #[test]
    fn zero_valued_edges_stay_finite() {
        // Zero price → zero revenue: margin undefined, ROI still defined.
        let mut bd = breakdown();
        reprice_product(&mut bd, 0.0, "Jita", 0.0);
        assert_eq!(bd.revenue, 0.0);
        assert_eq!(bd.margin, None);
        assert_eq!(bd.roi, Some(-1.0));

        // Zero cost → ROI undefined rather than infinite.
        let mut free = breakdown();
        free.material_cost = 0.0;
        free.job_fee = 0.0;
        reprice_product(&mut free, 5.0, "Jita", 0.0);
        assert_eq!(free.roi, None);
        assert_eq!(free.profit, 50.0);

        // Zero units → no division by zero in the per-unit figure.
        let mut empty = breakdown();
        empty.units_produced = 0;
        reprice_product(&mut empty, 5.0, "Jita", 0.0);
        assert_eq!(empty.profit_per_unit, 0.0);
    }
}

#[cfg(test)]
mod rig_bonus_tests {
    use super::*;
    use crate::modules::production::engine::SecurityTier;

    /// Dogma attribute bag for `Standup L-Set Reactor Efficiency II`
    /// (typeID 46497), read from the live SDE. RefRigMatBonus=-2.4,
    /// RefRigTimeBonus=-24, disallowInHighSec, lowSec=1.0, nullSec=1.1.
    fn reactor_efficiency_ii() -> Vec<(i64, f64)> {
        vec![
            (2713, -24.0),
            (2714, -2.4),
            (1970, 1.0),
            (2355, 1.0),
            (2356, 1.0),
            (2357, 1.1),
            (2358, 1.0),
        ]
    }

    #[test]
    fn refinery_rig_security_scaling_low_null_wh() {
        let a = reactor_efficiency_ii();
        // User-verified: hiSec disallowed, low=1.0, null/wh=1.1.
        assert_eq!(rig_security_multiplier(&a, SecurityTier::Highsec), 0.0);
        assert_eq!(rig_security_multiplier(&a, SecurityTier::Lowsec), 1.0);
        assert_eq!(rig_security_multiplier(&a, SecurityTier::Nullsec), 1.1);
        assert_eq!(rig_security_multiplier(&a, SecurityTier::Wormhole), 1.1);
    }

    #[test]
    fn standup_l_set_reactor_efficiency_ii_bonus() {
        // base 2.4% mat / 24% time; nullsec ×1.1 → 2.64 / 26.4; lowsec ×1.0 → 2.4 / 24.
        let a = reactor_efficiency_ii();
        let (me, te, cost) = rig_bonus_from_attrs(&a, SecurityTier::Nullsec).unwrap();
        assert!((me - 2.64).abs() < 1e-9, "mat {me}");
        assert!((te - 26.4).abs() < 1e-9, "time {te}");
        assert!(cost.abs() < 1e-9);
        let (me_lo, te_lo, _) = rig_bonus_from_attrs(&a, SecurityTier::Lowsec).unwrap();
        assert!((me_lo - 2.4).abs() < 1e-9);
        assert!((te_lo - 24.0).abs() < 1e-9);
    }

    #[test]
    fn non_industry_rig_yields_no_bonus() {
        // No RefRig*/EngRig* attrs (e.g. an ECM module) → None.
        assert!(rig_bonus_from_attrs(&[(2356, 1.0)], SecurityTier::Nullsec).is_none());
    }
}
