//! Production profit engine.
//!
//! Pure, network-free calculation: given a blueprint's SDE rows and a price map
//! it computes the profit of **building and selling** an item versus selling the
//! inputs. The model is activity-aware and tree-shaped:
//!
//! - a build step is a generic `(activity, inputs, output)` node ([`BuildStep`])
//! - each input carries its [`Sourcing`] — `Buy` (value at market) or `Build`
//!   (a recursive sub-step). Buildable inputs take the cheaper of build vs buy,
//!   recursively (manufacturing + reactions).
//! - T2 items carry an [`Invention`] whose expected cost is amortized in.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::market::PriceModel;
use crate::sde::{BlueprintMaterial, BlueprintProduct};

/// Industry activity for a build step. Manufacturing and Reaction (T3,
/// activity id 11) are both costed the same way in [`evaluate`]; T2 invention
/// cost is amortized separately via [`BuildStep::invention`], not through a
/// dedicated `Activity` variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum Activity {
    Manufacturing,
    Invention,
    Reaction,
}

/// Facility type for a [`FacilityProfile`]. Manufacturing profiles use
/// Upwell-structures or NPC stations; reaction profiles use Athanor/Tatara.
/// Component profiles apply to sub-build steps that are components of a larger
/// product (T2/T3 ship components, built at a different facility with different rigs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FacilityType {
    Manufacturing,
    Reaction,
    Components,
}

/// Upwell structure (or NPC station) type that hosts a manufacturing or
/// reaction job. Drives the base ME/TE/cost-index multipliers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum StructureType {
    NpcStation,
    Raitaru,
    Azbel,
    Sotiyo,
    Athanor,
    Tatara,
}

impl StructureType {
    /// Human-readable label for the UI.
    #[allow(dead_code)]
    pub fn label(self) -> &'static str {
        match self {
            StructureType::NpcStation => "NPC station",
            StructureType::Raitaru => "Raitaru",
            StructureType::Azbel => "Azbel",
            StructureType::Sotiyo => "Sotiyo",
            StructureType::Athanor => "Athanor",
            StructureType::Tatara => "Tatara",
        }
    }

    /// Combined structure + TE role bonus applied to material quantities.
    /// 1.0 = no structure bonus (NPC station).
    pub fn me_bonus(self) -> f64 {
        match self {
            StructureType::NpcStation => 1.0,
            // All Upwell structures give 1% ME per hull.
            StructureType::Raitaru | StructureType::Azbel | StructureType::Sotiyo => 0.99,
            StructureType::Athanor | StructureType::Tatara => 0.99,
        }
    }

    /// Combined structure TE bonus applied to job time (percent).
    /// 0 = no time bonus.
    pub fn te_bonus_pct(self) -> f64 {
        match self {
            StructureType::NpcStation => 0.0,
            StructureType::Raitaru => 15.0,
            StructureType::Azbel => 20.0,
            StructureType::Sotiyo => 30.0,
            // Reaction structures have no base TE; rigs provide it.
            StructureType::Athanor | StructureType::Tatara => 0.0,
        }
    }

    /// Combined structure cost saving on the cost-index portion of the job fee
    /// (fraction, e.g. 0.03 = −3%). 0.0 = none (NPC station).
    pub fn cost_bonus(self) -> f64 {
        match self {
            StructureType::NpcStation => 0.0,
            StructureType::Raitaru => 0.03,
            StructureType::Azbel => 0.04,
            StructureType::Sotiyo => 0.05,
            StructureType::Athanor => 0.04,
            StructureType::Tatara => 0.05,
        }
    }

    /// Tatara-specific role-bonus multiplier on **time** (0.25 = −25%).
    /// All other structures have no role time bonus.
    pub fn role_bonus_time(self) -> f64 {
        match self {
            StructureType::Tatara => 0.25,
            _ => 0.0,
        }
    }
}

/// Security tier of the system the facility sits in. Wormhole systems have
/// no live cost index, so results there are marked approximate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SecurityTier {
    Highsec,
    Lowsec,
    Nullsec,
    Wormhole,
}

impl SecurityTier {
    /// Human-readable label for the UI.
    #[allow(dead_code)]
    pub fn label(self) -> &'static str {
        match self {
            SecurityTier::Highsec => "Highsec",
            SecurityTier::Lowsec => "Lowsec",
            SecurityTier::Nullsec => "Nullsec",
            SecurityTier::Wormhole => "Wormhole",
        }
    }

    /// `true` when the system's live ESI cost index is unavailable and the
    /// profile must rely on a manual override (or the result is approximate).
    #[allow(dead_code)]
    pub fn has_no_live_cost_index(self) -> bool {
        matches!(self, SecurityTier::Wormhole)
    }
}

/// Security-tier multiplier applied to **T2** rigs in EVE (T1 rigs are
/// always full-strength). Values from the EVE University manufacturing
/// rigs article and verified against the SDE's `invTypes` group membership.
fn t2_rig_security_multiplier(security: SecurityTier) -> f64 {
    match security {
        SecurityTier::Highsec => 0.5,
        SecurityTier::Lowsec => 0.75,
        SecurityTier::Nullsec => 1.0,
        SecurityTier::Wormhole => 1.5,
    }
}

/// One manufacturing rig's bonus contribution (percentages, pre-security-scaling).
pub struct RigBonus {
    /// Material efficiency: e.g. 4.0 = −4% materials.
    pub me_pct: f64,
    /// Time efficiency: e.g. 4.0 = −4% time.
    pub te_pct: f64,
    /// Cost: e.g. 3.0 = −3% job fee.
    pub cost_pct: f64,
    /// Whether this is a T2 rig (security-scaling applies).
    pub is_t2: bool,
}

/// Well-known manufacturing and processing rig type IDs and their bonuses.
/// These are **game-mechanics constants** — the rig types and their bonus values
/// don't change with patches (only the type IDs are stable in the SDE).
/// Manufacturing rigs (IDs 1955-1966) work on manufacturing Upwell structures
/// (Raitaru/Azbel/Sotiyo) and NPC stations; processing rigs (IDs 1967-1978)
/// work on reaction Upwell structures (Athanor/Tatara).
///
/// T1 rigs: full bonus. T2 rigs: scaled by `t2_rig_security_multiplier`.
/// Small rigs give ~50% of medium bonuses (game design, not SDE data).
pub fn rig_bonus_lookup(type_id: i64) -> Option<RigBonus> {
    let b = match type_id {
        // Medium manufacturing rigs
        1955 => RigBonus {
            me_pct: 0.0,
            te_pct: 4.0,
            cost_pct: 0.0,
            is_t2: false,
        }, // Medium ME Time Rig I
        1956 => RigBonus {
            me_pct: 0.0,
            te_pct: 5.0,
            cost_pct: 0.0,
            is_t2: true,
        }, // Medium ME Time Rig II
        1957 => RigBonus {
            me_pct: 4.0,
            te_pct: 0.0,
            cost_pct: 0.0,
            is_t2: false,
        }, // Medium ME Material Rig I
        1958 => RigBonus {
            me_pct: 5.0,
            te_pct: 0.0,
            cost_pct: 0.0,
            is_t2: true,
        }, // Medium ME Material Rig II
        1959 => RigBonus {
            me_pct: 0.0,
            te_pct: 0.0,
            cost_pct: 3.0,
            is_t2: false,
        }, // Medium ME Cost Rig I
        1960 => RigBonus {
            me_pct: 0.0,
            te_pct: 0.0,
            cost_pct: 4.0,
            is_t2: true,
        }, // Medium ME Cost Rig II
        // Small manufacturing rigs (~50% of medium)
        1961 => RigBonus {
            me_pct: 0.0,
            te_pct: 2.0,
            cost_pct: 0.0,
            is_t2: false,
        },
        1962 => RigBonus {
            me_pct: 0.0,
            te_pct: 2.5,
            cost_pct: 0.0,
            is_t2: true,
        },
        1963 => RigBonus {
            me_pct: 2.0,
            te_pct: 0.0,
            cost_pct: 0.0,
            is_t2: false,
        },
        1964 => RigBonus {
            me_pct: 2.5,
            te_pct: 0.0,
            cost_pct: 0.0,
            is_t2: true,
        },
        1965 => RigBonus {
            me_pct: 0.0,
            te_pct: 0.0,
            cost_pct: 1.5,
            is_t2: false,
        },
                1966 => RigBonus {
            me_pct: 0.0,
            te_pct: 0.0,
            cost_pct: 2.0,
            is_t2: true,
        },
        // Medium processing rigs (reaction activity)
        1967 => RigBonus {
            me_pct: 0.0,
            te_pct: 4.0,
            cost_pct: 0.0,
            is_t2: false,
        }, // Medium Processing Time Rig I
        1968 => RigBonus {
            me_pct: 0.0,
            te_pct: 5.0,
            cost_pct: 0.0,
            is_t2: true,
        }, // Medium Processing Time Rig II
        1969 => RigBonus {
            me_pct: 4.0,
            te_pct: 0.0,
            cost_pct: 0.0,
            is_t2: false,
        }, // Medium Processing Material Rig I
        1970 => RigBonus {
            me_pct: 5.0,
            te_pct: 0.0,
            cost_pct: 0.0,
            is_t2: true,
        }, // Medium Processing Material Rig II
        1971 => RigBonus {
            me_pct: 0.0,
            te_pct: 0.0,
            cost_pct: 3.0,
            is_t2: false,
        }, // Medium Processing Cost Rig I
        1972 => RigBonus {
            me_pct: 0.0,
            te_pct: 0.0,
            cost_pct: 4.0,
            is_t2: true,
        }, // Medium Processing Cost Rig II
        // Small processing rigs (~50% of medium)
        1973 => RigBonus {
            me_pct: 0.0,
            te_pct: 2.0,
            cost_pct: 0.0,
            is_t2: false,
        }, // Small Processing Time Rig I
        1974 => RigBonus {
            me_pct: 0.0,
            te_pct: 2.5,
            cost_pct: 0.0,
            is_t2: true,
        }, // Small Processing Time Rig II
        1975 => RigBonus {
            me_pct: 2.0,
            te_pct: 0.0,
            cost_pct: 0.0,
            is_t2: false,
        }, // Small Processing Material Rig I
        1976 => RigBonus {
            me_pct: 2.5,
            te_pct: 0.0,
            cost_pct: 0.0,
            is_t2: true,
        }, // Small Processing Material Rig II
        1977 => RigBonus {
            me_pct: 0.0,
            te_pct: 0.0,
            cost_pct: 1.5,
            is_t2: false,
        }, // Small Processing Cost Rig I
        1978 => RigBonus {
            me_pct: 0.0,
            te_pct: 0.0,
            cost_pct: 2.0,
            is_t2: true,
        }, // Small Processing Cost Rig II
        _ => return None,
    };
    Some(b)
}

/// Sum the rig bonuses for a set of rig type IDs, applying the security-tier
/// scaling for T2 rigs. Returns `(me_bonus, te_bonus_pct, cost_bonus_pct)` —
/// the totals to fold into a [`FacilityProfile`].
#[allow(dead_code)]
pub fn rig_bonuses_from_ids(rig_type_ids: &[i64], security: SecurityTier) -> (f64, f64, f64) {
    let mult = t2_rig_security_multiplier(security);
    let mut me_pct = 0.0_f64;
    let mut te_pct = 0.0_f64;
    let mut cost_pct = 0.0_f64;
    for &id in rig_type_ids {
        if let Some(b) = rig_bonus_lookup(id) {
            let m = if b.is_t2 { mult } else { 1.0 };
            me_pct += b.me_pct * m;
            te_pct += b.te_pct * m;
            cost_pct += b.cost_pct * m;
        }
    }
    // Convert ME percent to a multiplier (e.g. 4% → 0.96).
    let me_bonus = 1.0 - me_pct / 100.0;
    (me_bonus, te_pct, cost_pct)
}

/// A production-capacity profile: the facility a job runs in, with its
/// structure/rig/security bonuses composed. One profile per facility type
/// (manufacturing vs. reaction); passed through the recursive build-vs-buy
/// tree so each step is costed against the right facility.
///
/// The `me_bonus`/`te_bonus_pct`/`cost_bonus` fields here are the **final
/// composed multipliers** (structure × rig), not raw rig percentages — the
/// frontend computes them the same way `composeStructureBonuses` does today
/// and hands them in pre-composed, so the engine stays flat and pure.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FacilityProfile {
    /// Which activity this profile applies to (drives structure preset).
    pub facility_type: FacilityType,
    /// The structure type (Raitaru, Tatara, etc.) or NPC station.
    pub structure: StructureType,
    /// Security tier of the system (determines approximate-ness).
    pub security: SecurityTier,
    /// Combined structure+rig material multiplier (e.g. 0.97 = −3%).
    pub me_bonus: f64,
    /// Combined structure+rig TE bonus in percent (e.g. 20 = −20% time).
    pub te_bonus_pct: f64,
    /// Combined structure+rig cost saving on cost-index portion (fraction).
    pub cost_bonus: f64,
    /// Tatara role-bonus time multiplier (0.25 for Tatara, 0 otherwise).
    pub role_bonus_time: f64,
    /// Selected rig type IDs (from the `production_manufacturing_rigs` list).
    /// The frontend sends these; the engine computes ME/TE/cost via
    /// [`rig_bonuses_from_ids`] and folds them into the bonuses above.
    pub rig_type_ids: Vec<i64>,
    /// System cost index (0..1), or `None` for WH (manual override).
    pub system_cost_index: Option<f64>,
    /// Facility tax rate (0..1), or `None` for manual override.
    pub tax_rate: Option<f64>,
}

impl Default for FacilityProfile {
    fn default() -> Self {
        FacilityProfile {
            facility_type: FacilityType::Manufacturing,
            structure: StructureType::NpcStation,
            security: SecurityTier::Highsec,
            me_bonus: 1.0,
            te_bonus_pct: 0.0,
            cost_bonus: 0.0,
            role_bonus_time: 0.0,
            rig_type_ids: vec![],
            system_cost_index: None,
            tax_rate: None,
        }
    }
}

impl FacilityProfile {
    /// Whether this facility's results should be flagged approximate
    /// (true when system_cost_index or tax_rate is None).
    pub fn is_approximate(&self) -> bool {
        self.system_cost_index.is_none() || self.tax_rate.is_none()
    }

    /// Effective system cost index — falls back to `0.0` when None, so the
    /// calculation doesn't divide by zero; `is_approximate()` flags the caveat.
    pub fn cost_index_or_zero(&self) -> f64 {
        self.system_cost_index.unwrap_or(0.0)
    }

    /// Effective facility tax — falls back to `0.0` when None.
    pub fn tax_or_zero(&self) -> f64 {
        self.tax_rate.unwrap_or(0.0)
    }

    /// Build a profile from a structure type + security tier, composing the
    /// structure's base bonuses with optional rig percentage overrides.
    /// `rig_me_pct`, `rig_te_pct`, `rig_cost_pct` are the **effective** rig bonuses
    /// (e.g. 2.0 = 2% ME rig in null — the user supplies the security-adjusted value).
    /// `system_cost_index` and `tax_rate` default to `None` (manual / approximate).
    #[allow(clippy::too_many_arguments)]
    #[allow(dead_code)]
    pub fn from_structure(
        facility_type: FacilityType,
        structure: StructureType,
        security: SecurityTier,
        rig_type_ids: Vec<i64>,
        system_cost_index: Option<f64>,
        tax_rate: Option<f64>,
    ) -> Self {
        let base_me = structure.me_bonus();
        let base_te = structure.te_bonus_pct();
        let base_cost = structure.cost_bonus();
        let role = structure.role_bonus_time();
        // Compute rig bonuses from the selected rig type IDs + security.
        let (rig_me, rig_te, rig_cost_pct) = rig_bonuses_from_ids(&rig_type_ids, security);
        FacilityProfile {
            facility_type,
            structure,
            security,
            // Structure ME × rig ME: multiplicative stacking.
            me_bonus: base_me * rig_me,
            te_bonus_pct: base_te + rig_te,
            // Cost: 1 − (1−structure) × (1−rig_pct/100) — rig_cost_pct is e.g. 3.0.
            cost_bonus: 1.0 - (1.0 - base_cost) * (1.0 - rig_cost_pct / 100.0),
            role_bonus_time: role,
            rig_type_ids,
            system_cost_index,
            tax_rate,
        }
    }
}

/// A triple of facility profiles: manufacturing, reaction, and components.
/// Passed through the build-vs-buy tree so each `Activity::Manufacturing`
/// node uses the manufacturing or components facility (depending on whether
/// it's a top-level product or a sub-component) and each `Activity::Reaction`
/// node uses the reaction facility.
///
/// `components` is always a manufacturing-type facility (NPC station or
/// Upwell manufacturing structure) — it just has its own cost index, tax,
/// and rig bonus set because components are often built at a different
/// location than the final product.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FacilityProfiles {
    pub manufacturing: FacilityProfile,
    pub reaction: FacilityProfile,
    pub components: FacilityProfile,
}

impl Default for FacilityProfiles {
    fn default() -> Self {
        FacilityProfiles {
            manufacturing: FacilityProfile::default(),
            reaction: FacilityProfile::default(),
            components: FacilityProfile::default(),
        }
    }
}

impl FacilityProfiles {
    /// Borrow the profile matching an activity. `Activity::Invention` uses the
    /// manufacturing facility (invention is a science job run at a manufacturing
    /// structure or NPC station).
    /// When `is_component` is true, the `components` profile is used instead
    /// of `manufacturing` — this lets the user specify a separate facility with
    /// different rigs/cost index/tax for building components of T2/T3 products.
    pub fn for_activity(&self, activity: Activity) -> &FacilityProfile {
        match activity {
            Activity::Manufacturing | Activity::Invention => &self.manufacturing,
            Activity::Reaction => &self.reaction,
        }
    }

    pub fn for_step(&self, step: &BuildStep) -> &FacilityProfile {
        match step.activity {
            Activity::Reaction => &self.reaction,
            Activity::Manufacturing | Activity::Invention => {
                if step.is_component { &self.components } else { &self.manufacturing }
            }
        }
    }
}

/// Which price vector to value a role (materials or product) with. Defaults use
/// `SellMin`; the rest are user-selectable in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum PriceBasis {
    SellMin,
    BuyMax,
    SellPercentile,
    BuyPercentile,
    AdjustedPrice,
    AveragePrice,
}

/// How an input is obtained.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum Sourcing {
    /// Value the input at market (v1 default).
    Buy,
    /// Build it from a sub-step (recursive build-vs-buy across the input tree).
    Build(Box<BuildStep>),
}

/// One input line of a build step (pre-ME base quantity, per run).
#[derive(Debug, Clone)]
pub struct InputLine {
    pub type_id: i64,
    pub name: String,
    pub base_quantity: i64,
    pub sourcing: Sourcing,
}

/// Invention prerequisite for a T2 build (SDE activity 8). Its expected cost is
/// amortized into the manufacturing cost.
#[derive(Debug, Clone)]
pub struct Invention {
    /// Datacores (+ any other inputs) consumed per attempt.
    pub datacores: Vec<InputLine>,
    /// The T1 product's manufacturing materials, used to estimate the copy job
    /// fee for the consumed T1 BPC (EIV × cost index).
    pub copy_materials: Vec<InputLine>,
    /// The T1 blueprint copied/consumed each attempt — what "invented from"
    /// names in the UI. For T3 invention this is the Ancient Relic's own type
    /// id (it isn't copied, but the id still identifies the product's source).
    pub base_blueprint_type_id: i64,
    /// Runs on the resulting T2 BPC per successful attempt.
    pub runs_per_success: i64,
    /// Success probability (0..1).
    pub probability: f64,
    /// Material efficiency of the invented T2 BPC (base 2 + decryptor). Used for
    /// the T2 manufacturing material quantities instead of the user ME.
    pub result_me: i64,
}

/// A generic build step: some activity turning inputs into a product.
#[derive(Debug, Clone)]
pub struct BuildStep {
    pub activity: Activity,
    pub blueprint_type_id: i64,
    pub product_type_id: i64,
    pub product_name: String,
    pub product_per_run: i64,
    pub inputs: Vec<InputLine>,
    /// Set for T2 items: invention must succeed before manufacturing.
    pub invention: Option<Invention>,
    /// Whether this build step is a component of a larger product (T2/T3 ship
    /// components). When true, `FacilityProfiles::for_activity` selects the
    /// `components` facility profile instead of `manufacturing`.
    pub is_component: bool,
}

/// Tunables for a profit calculation. Defaults value everything at Jita sell-min
/// with no fees; callers override the cost index / taxes per system & structure.
#[derive(Debug, Clone)]
pub struct ProfitConfig {
    pub material_basis: PriceBasis,
    pub product_basis: PriceBasis,
    /// Manufacturing system cost index (0..1), from ESI `/industry/systems/`.
    pub system_cost_index: f64,
    /// Structure/facility tax fraction applied on top of the job fee.
    pub facility_tax: f64,
    /// Sales tax fraction (applied to revenue when `include_sales_cost`).
    pub sales_tax: f64,
    /// Broker fee fraction (applied to revenue when `include_sales_cost`).
    pub broker_fee: f64,
    /// Whether to subtract sales tax + broker fee from revenue.
    pub include_sales_cost: bool,
    /// Cost to acquire the blueprint copy, amortized **per run** (e.g. a faction
    /// or officer BPC from an LP store). Multiplied by `runs`.
    pub blueprint_cost_per_run: f64,
    /// Multiplier on the SDE base invention probability from the inventor's
    /// skills/decryptor (1.0 = base/skill-0; ~1.458 = all science skills at V).
    pub invention_skill_multiplier: f64,
    /// Combined structure+rig **material** multiplier (e.g. 0.99 = −1% materials);
    /// applied on top of blueprint ME. 1.0 = no structure bonus.
    pub me_bonus: f64,
    /// Combined structure+rig **cost** saving on the system-cost-index portion of
    /// the job fee (e.g. 0.03 = −3%). 0.0 = none.
    pub cost_bonus: f64,
    /// Combined structure+rig **time** bonus for manufacturing (percent, e.g.
    /// 20 = −20% time). Flat fallback when no facility profile is set.
    pub structure_te_pct: f64,
    /// Role-bonus time multiplier (0.25 for Tatara, 0 for others).
    /// Flat fallback when no facility profile is configured.
    pub role_bonus_time: f64,
    /// SCC surcharge fraction of EIV added to the job fee (CCP's 4%, applied to
    /// all job types — manufacturing, invention, copying, etc., not just
    /// manufacturing). 0.0 in the engine default; the command sets the real value.
    pub scc_surcharge: f64,
        /// Optional facility profiles for manufacturing and reaction steps.
    /// When `Some`, each step selects its profile by `Activity` (via
    /// [`FacilityProfiles::for_activity`]); when `None`, the flat `me_bonus` /
    /// `cost_bonus` / `system_cost_index` / `facility_tax` fields are used as-is
    /// (backward compatibility with the old single-structure API).
    pub facility_profiles: Option<FacilityProfiles>,
    /// Optional character implant(s) / facility module bonuses that apply on
    /// top of the facility profile's bonuses (time, ME, cost).
    pub implant: Option<ImplantBonus>,
    /// Owned blueprint ME per type id (for per-blueprint ME override). Used
    /// for sub-component ME when `build_components` is true.
    #[serde(default)]
    pub owned_me: HashMap<i64, i64>,
    /// Owned blueprint TE per type id (for per-blueprint TE override). Used
    /// for sub-component TE when `build_components` is true.
    #[serde(default)]
    pub owned_te: HashMap<i64, i64>,
}

/// Character implant or facility module bonus that applies on top of the
/// facility profile's bonuses. EVE Online has several implants (e.g.
/// Eifyr 'Guns' series) and facility modules that reduce manufacturing time
/// and/or material costs — these are character/facility-level, not rig-level.
///
/// Bonuses are additive within their category and applied multiplicatively
/// against the facility-derived totals:
/// - `time_bonus_pct`: additional time reduction % (stacks with TE bonus).
/// - `material_bonus`: additional ME multiplier (e.g. 0.99 = −1% materials,
///   multiplicative with the facility ME bonus).
/// - `cost_bonus_pct`: additional cost-index reduction % (additive with TE bonus).
///
/// `None` means no implant/module configured — equivalent to zero bonuses.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImplantBonus {
    /// Additional manufacturing time reduction (percent, e.g. 4.0 = −4%).
    /// Applied as a multiplier on top of the facility TE bonus.
    pub time_bonus_pct: f64,
    /// Additional material efficiency multiplier (e.g. 0.99 = −1%).
    /// Applied multiplicatively with the facility ME bonus.
    pub material_bonus: f64,
    /// Additional job-fee cost reduction (percent, e.g. 2.0 = −2%).
    /// Applied as an additional saving on the cost-index portion.
    pub cost_bonus_pct: f64,
}

impl Default for ProfitConfig {
    fn default() -> Self {
        Self {
            material_basis: PriceBasis::SellMin,
            product_basis: PriceBasis::SellMin,
            system_cost_index: 0.0,
            facility_tax: 0.0,
            sales_tax: 0.0,
            broker_fee: 0.0,
            include_sales_cost: false,
            blueprint_cost_per_run: 0.0,
            invention_skill_multiplier: 1.0,
            me_bonus: 1.0,
            cost_bonus: 0.0,
            structure_te_pct: 0.0,
            role_bonus_time: 0.0,
                scc_surcharge: 0.0,
                            facility_profiles: None,
            implant: None,
            owned_me: HashMap::new(),
            owned_te: HashMap::new(),
        }
    }
}

impl ProfitConfig {
    /// ME multiplier for a build step: the facility profile's value if profiles
    /// are configured, otherwise the flat `me_bonus` field (backward compat).
    pub fn me_bonus_for(&self, activity: Activity) -> f64 {
        self.facility_profiles
            .as_ref()
            .map(|p| p.for_activity(activity).me_bonus)
            .unwrap_or(self.me_bonus)
    }

        /// ME bonus for a build step — uses the components profile when `step.is_component`
    /// is true, otherwise the manufacturing/invention profile.
    /// Includes implant material bonus: facility ME × implant material_bonus.
    pub fn me_bonus_for_step(&self, step: &BuildStep) -> f64 {
        let facility_me = self
            .facility_profiles
            .as_ref()
            .map(|p| p.for_step(step).me_bonus)
            .unwrap_or(self.me_bonus);
        let implant_me = self
            .implant
            .as_ref()
            .map(|i| i.material_bonus)
            .unwrap_or(1.0);
        facility_me * implant_me
    }

    /// Cost-index saving fraction for a build step (profile or flat fallback).
    pub fn cost_bonus_for(&self, activity: Activity) -> f64 {
        self.facility_profiles
            .as_ref()
            .map(|p| p.for_activity(activity).cost_bonus)
            .unwrap_or(self.cost_bonus)
    }

    /// System cost index (0..1) for a build step (profile or flat fallback).
    pub fn system_cost_index_for(&self, activity: Activity) -> f64 {
        self.facility_profiles
            .as_ref()
            .map(|p| p.for_activity(activity).cost_index_or_zero())
            .unwrap_or(self.system_cost_index)
    }

    /// Facility tax rate (0..1) for a build step (profile or flat fallback).
    pub fn facility_tax_for(&self, activity: Activity) -> f64 {
        self.facility_profiles
            .as_ref()
            .map(|p| p.for_activity(activity).tax_or_zero())
            .unwrap_or(self.facility_tax)
    }

        /// Whether any facility result is approximate (cost index or tax is None).
    pub fn is_approximate(&self) -> bool {
        self.facility_profiles
            .as_ref()
            .map(|p| {
                p.manufacturing.is_approximate()
                    || p.reaction.is_approximate()
                    || p.components.is_approximate()
            })
            .unwrap_or(false)
    }

    /// TE bonus percent (structure + rig, e.g. 20 = −20%) for a build step.
    /// Profile-aware; flat fallback is `structure_te_pct`.
    pub fn te_bonus_pct_for(&self, activity: Activity) -> f64 {
        self.facility_profiles
            .as_ref()
            .map(|p| p.for_activity(activity).te_bonus_pct)
            .unwrap_or(self.structure_te_pct)
    }

        /// TE bonus percent for a build step, including implant time bonus.
    /// Facility TE + implant time_bonus_pct (additive in percent).
    pub fn te_bonus_pct_for_step(&self, step: &BuildStep) -> f64 {
        let facility_te = self.facility_profiles
            .as_ref()
            .map(|p| p.for_step(step).te_bonus_pct)
            .unwrap_or(self.structure_te_pct);
        let implant_te = self.implant.as_ref().map(|i| i.time_bonus_pct).unwrap_or(0.0);
        facility_te + implant_te
    }

    /// Role-bonus time multiplier (0.25 for Tatara, 0 otherwise) for a step.
    /// Profile-aware; flat fallback is `role_bonus_time`.
    pub fn role_bonus_time_for(&self, activity: Activity) -> f64 {
        self.facility_profiles
            .as_ref()
            .map(|p| p.for_activity(activity).role_bonus_time)
            .unwrap_or(self.role_bonus_time)
    }

    /// Role-bonus time multiplier for a build step.
    pub fn role_bonus_time_for_step(&self, step: &BuildStep) -> f64 {
        self.facility_profiles
            .as_ref()
            .map(|p| p.for_step(step).role_bonus_time)
            .unwrap_or(self.role_bonus_time)
    }

    /// System cost index for a build step (uses components profile when applicable).
    pub fn system_cost_index_for_step(&self, step: &BuildStep) -> f64 {
        self.facility_profiles
            .as_ref()
            .map(|p| p.for_step(step).cost_index_or_zero())
            .unwrap_or(self.system_cost_index)
    }

    /// Facility tax rate for a build step (uses components profile when applicable).
    pub fn facility_tax_for_step(&self, step: &BuildStep) -> f64 {
        self.facility_profiles
            .as_ref()
            .map(|p| p.for_step(step).tax_or_zero())
            .unwrap_or(self.facility_tax)
    }

        /// Cost-index saving fraction for a build step, including implant cost bonus.
    /// Facility cost_bonus + implant cost_bonus_pct/100 (additive).
    pub fn cost_bonus_for_step(&self, step: &BuildStep) -> f64 {
                let facility_cost = self
            .facility_profiles
            .as_ref()
            .map(|p| p.for_step(step).cost_bonus)
            .unwrap_or(self.cost_bonus);
        let implant_cost = self
            .implant
            .as_ref()
            .map(|i| i.cost_bonus_pct / 100.0)
            .unwrap_or(0.0);
        facility_cost + implant_cost
    }
}

/// EVE job install cost from EIV: system-cost-index (less structure/rig cost
/// bonus) + facility tax + SCC surcharge, all on the estimated item value.
/// Profile-aware: selects ME/cost-index/tax from the facility profile matching
/// the build step's activity (and components profile for component steps),
/// or falls back to flat config fields when no profile is set.
fn job_fee(eiv: f64, config: &ProfitConfig, step: &BuildStep) -> f64 {
    eiv * config.system_cost_index_for_step(step)
        * (1.0 - config.cost_bonus_for_step(step))
        + eiv * config.facility_tax_for_step(step)
        + eiv * config.scc_surcharge
}

/// Per-material cost line for the UI drill-down.
#[derive(Debug, Clone, Serialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MaterialLine {
    pub type_id: i64,
    pub name: String,
    pub required_quantity: i64,
    /// Units covered from owned stock (#41); `line_cost` only pays the shortfall.
    pub have: i64,
    /// Unit cost used (the cheaper of build vs buy when buildable).
    pub unit_price: Option<f64>,
    pub line_cost: f64,
    /// True when building this input is cheaper than buying it.
    pub built: bool,
}

/// Invention cost detail for the drill-down (T2 items).
#[derive(Debug, Clone, Serialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InventionBreakdown {
    /// Datacores consumed per attempt (quantity, unit price, cost).
    pub datacores: Vec<MaterialLine>,
    pub datacore_cost: f64,
    pub invention_job_fee: f64,
    /// Copy job fee for the T1 BPC consumed each attempt.
    pub copy_fee: f64,
    pub attempt_cost: f64,
    /// Skill-adjusted success probability (0..1).
    pub probability: f64,
    pub runs_per_success: i64,
    /// Invention cost per produced unit-run = attempt_cost / (probability × runs).
    pub per_unit: f64,
    /// The T1 blueprint invented from — id + name, so the UI can show what a
    /// T2 item's invention is actually based on. Name is filled by the command
    /// layer from the SDE; the pure engine leaves it empty.
    pub base_blueprint_type_id: i64,
    pub base_blueprint_name: String,
}

/// How deep the recursive build-vs-buy resolver descends.
const MAX_BUILD_DEPTH: u32 = 8;

/// Per-unit cost to **build** this step's product, recursively choosing the
/// cheaper of build vs buy for each input. `None` if the subtree can't be fully
/// priced (so the caller falls back to buying).
fn build_unit_cost(
    step: &BuildStep,
    prices: &HashMap<i64, PriceModel>,
    config: &ProfitConfig,
    depth: u32,
) -> Option<f64> {
        if depth == 0 || step.product_per_run <= 0 {
        return None;
    }
    let component_me = config
        .owned_me
        .get(&step.product_type_id)
        .copied()
        .unwrap_or(0);
    let me_bonus = config.me_bonus_for_step(step);
    let mut materials_total = 0.0;
    let mut eiv = 0.0;
    for input in &step.inputs {
        let model = prices.get(&input.type_id);
        let buy_unit = price_for(model, config.material_basis);
        let unit = match &input.sourcing {
            Sourcing::Build(sub) => {
                match (build_unit_cost(sub, prices, config, depth - 1), buy_unit) {
                    (Some(b), Some(y)) => b.min(y),
                    (Some(b), None) => b,
                    (None, Some(y)) => y,
                    (None, None) => return None,
                }
            }
            Sourcing::Buy => buy_unit?,
        };
        // Apply ME to material quantities: use owned_me for this blueprint type
        // when available, falling back to the manual `me` value via required_quantity.
        let qty = required_quantity(
            input.base_quantity,
            component_me,
            me_bonus,
        );
        materials_total += qty as f64 * unit;
        eiv += eiv_unit_value(model) * input.base_quantity as f64;
    }
    let job_fee = job_fee(eiv, config, step);
    Some((materials_total + job_fee) / step.product_per_run as f64)
}

/// Recursively sum the install cost (job fee) of all Reaction sub-steps in
/// a build tree. Used to populate `reaction_install_cost` in `ProfitBreakdown`.
/// Each Reaction node's EIV is computed from its base-quantity inputs at
/// adjusted price, then passed through the profile-aware [`job_fee`].
fn sum_reaction_install_cost(
    step: &BuildStep,
    prices: &HashMap<i64, PriceModel>,
    config: &ProfitConfig,
    depth: u32,
) -> f64 {
    if depth == 0 {
        return 0.0;
    }
    let mut total = 0.0;
    if step.activity == Activity::Reaction {
        let eiv: f64 = step
            .inputs
            .iter()
            .map(|m| eiv_unit_value(prices.get(&m.type_id)) * m.base_quantity as f64)
            .sum();
        total += job_fee(eiv, config, step);
    }
    for input in &step.inputs {
        if let Sourcing::Build(sub) = &input.sourcing {
            total += sum_reaction_install_cost(sub, prices, config, depth - 1);
        }
    }
    total
}

/// The result of evaluating a build step.
#[derive(Debug, Clone, Serialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfitBreakdown {
    pub blueprint_type_id: i64,
    pub product_type_id: i64,
    pub product_name: String,
    pub runs: i64,
    pub me: i64,
    /// Total manufacturing time for the job (all runs), in seconds. Filled by the
    /// command layer (needs SDE base time + TE/skill/structure); 0 otherwise.
    pub job_time_seconds: f64,
    pub units_produced: i64,
    pub material_cost: f64,
    pub job_fee: f64,
    /// Manufacturing system cost index used for this row's facility jobs.
    pub manufacturing_cost_index: f64,
    /// Total install cost (job fee) for manufacturing, in ISK.
    pub manufacturing_install_cost: f64,
    /// Total manufacturing job time for this row, in seconds (all runs).
    pub manufacturing_time_seconds: f64,
    /// Reaction install cost (job fee) for the top-level step, in ISK.
    pub reaction_install_cost: f64,
    /// Total reaction job time for this row, in seconds (all runs).
    pub reaction_time_seconds: f64,
    /// Whether the result is approximate (facility cost index or tax is None —
    /// e.g. wormhole space with a manual override).
    pub approximate: bool,
    /// Amortized blueprint acquisition cost for this job (per-run cost × runs).
    pub blueprint_cost: f64,
    /// Amortized invention cost for this job (T2 items; 0 otherwise).
    pub invention_cost: f64,
    /// Invention cost detail (T2 items only).
    pub invention: Option<InventionBreakdown>,
    pub revenue: f64,
    pub profit: f64,
    /// Profit / revenue, or `None` when revenue is zero. Capped at 100%.
    pub margin: Option<f64>,
    /// Return on investment: profit / cost. Can exceed 100% (e.g. build for
    /// 100, sell for 600 -> 500%). `None` when cost is zero.
    pub roi: Option<f64>,
    pub profit_per_unit: f64,
    /// Meta group of the product (Tech I/II, Faction, Officer, …). Filled by the
    /// command layer from the SDE; the pure engine leaves it `None`.
    pub meta_group: Option<String>,
    /// Category of the product (Ship, Module, Charge, …). Filled by the command
    /// layer from the SDE; the pure engine leaves it `None`.
    pub category: Option<String>,
    /// Group of the product (Frigate, Cruiser, …). Filled by the command layer.
    pub group: Option<String>,
    /// Which market this result was priced at. Filled by the command layer; the
    /// pure engine leaves it `None`.
    pub market: Option<String>,
    /// Best hub to sell the product at (when "sell at best hub" is on). Filled by
    /// the command layer; `None` otherwise.
    pub sell_hub: Option<String>,
    /// Whether the user has favorited this item. Filled by the command layer.
    pub favorite: bool,
    /// Product daily volume (liquidity), for downstream filtering.
    pub product_volume: Option<i64>,
    /// Per-unit sell price of the product at the chosen basis (the target price).
    pub product_price: Option<f64>,
    pub materials: Vec<MaterialLine>,
    /// Type ids we could not price; the row's numbers are incomplete when set.
    pub missing_prices: Vec<i64>,
}

/// ME-adjusted required quantity of a material for `runs` runs. `me_bonus` is the
/// combined structure/rig material multiplier (1.0 = none, 0.99 = −1%).
///
/// `max(runs, ceil(base * runs * (1 - me/100) * me_bonus))` — at least one per run.
pub fn required_quantity(base_quantity: i64, runs: i64, me: i64, me_bonus: f64) -> i64 {
    let factor = (1.0 - (me as f64) / 100.0) * me_bonus;
    let raw = (base_quantity as f64) * (runs as f64) * factor;
    (raw.ceil() as i64).max(runs)
}

/// Build a single-level manufacturing step from SDE rows (all inputs `Buy`).
pub fn manufacturing_step(
    blueprint_type_id: i64,
    product: &BlueprintProduct,
    materials: &[BlueprintMaterial],
) -> BuildStep {
        BuildStep {
        activity: Activity::Manufacturing,
        blueprint_type_id,
        product_type_id: product.product_type_id,
        product_name: product.name.clone(),
        product_per_run: product.quantity,
        inputs: materials
            .iter()
            .map(|m| InputLine {
                type_id: m.material_type_id,
                name: m.name.clone(),
                base_quantity: m.quantity,
                sourcing: Sourcing::Buy,
            })
            .collect(),
        invention: None,
        is_component: false,
    }
}

fn price_for(model: Option<&PriceModel>, basis: PriceBasis) -> Option<f64> {
    let m = model?;
    match basis {
        PriceBasis::SellMin => m.sell_min,
        PriceBasis::BuyMax => m.buy_max,
        PriceBasis::SellPercentile => m.sell_percentile,
        PriceBasis::BuyPercentile => m.buy_percentile,
        PriceBasis::AdjustedPrice => m.adjusted_price,
        // "Weighted average" in the UI: the location-local weighted average
        // when the bulk path supplied one, else the ESI global average (#776).
        PriceBasis::AveragePrice => m.weighted_average.or(m.average_price),
    }
}

/// EIV unit value of a material (adjusted price, falling back to average).
fn eiv_unit_value(model: Option<&PriceModel>) -> f64 {
    model
        .and_then(|m| m.adjusted_price.or(m.average_price))
        .unwrap_or(0.0)
}

/// Evaluate a (manufacturing) build step into a profit breakdown. The no-stock
/// convenience over [`evaluate_with_stock`]; used by the engine's unit tests.
#[allow(dead_code)]
pub fn evaluate(
    step: &BuildStep,
    runs: i64,
    me: i64,
    prices: &HashMap<i64, PriceModel>,
    config: &ProfitConfig,
) -> ProfitBreakdown {
    evaluate_with_stock(step, runs, me, prices, config, &HashMap::new())
}

/// Like [`evaluate`] but nets `stock` (type id → owned quantity) against the
/// top-level bill of materials: you only pay for the shortfall of each input you
/// already own ("Have"). Job fee (EIV) is unaffected — it doesn't depend on what
/// you hold. Stock is applied at the top level only, not deep in sub-builds.
pub fn evaluate_with_stock(
    step: &BuildStep,
    runs: i64,
    me: i64,
    prices: &HashMap<i64, PriceModel>,
    config: &ProfitConfig,
    stock: &HashMap<i64, i64>,
) -> ProfitBreakdown {
    debug_assert!(
        step.product_per_run > 0,
        "evaluate_with_stock on a zero-yield step"
    );
    let mut missing_prices = Vec::new();

    // T2 items use the invented BPC's ME (base 2 + decryptor), not the user ME.
    let effective_me = step
        .invention
        .as_ref()
        .map(|inv| inv.result_me)
        .unwrap_or(me);

    // Materials: ME-adjusted quantity valued at the material price basis.
    let mut material_cost = 0.0;
    let mut eiv = 0.0;
    let mut materials = Vec::with_capacity(step.inputs.len());
    for input in &step.inputs {
        let model = prices.get(&input.type_id);
        let required = required_quantity(
            input.base_quantity,
            runs,
            effective_me,
            config.me_bonus_for_step(step),
        );
        let buy_unit = price_for(model, config.material_basis);
        // Buildable inputs (a sub-recipe) take the cheaper of build vs buy.
        let (unit_price, built) = match &input.sourcing {
            Sourcing::Build(sub) => {
                match (
                    build_unit_cost(sub, prices, config, MAX_BUILD_DEPTH),
                    buy_unit,
                ) {
                    (Some(b), Some(y)) if b < y => (Some(b), true),
                    (Some(_), Some(y)) => (Some(y), false),
                    (Some(b), None) => (Some(b), true),
                    (None, y) => (y, false),
                }
            }
            Sourcing::Buy => (buy_unit, false),
        };
        // Net owned stock: only pay for the shortfall you don't already hold.
        let have = required.min(stock.get(&input.type_id).copied().unwrap_or(0));
        let to_source = required - have;
        let line_cost = match unit_price {
            Some(p) => p * to_source as f64,
            None => {
                if to_source > 0 {
                    missing_prices.push(input.type_id);
                }
                0.0
            }
        };
        material_cost += line_cost;
        // EIV uses base (pre-ME) quantities at adjusted price, across all runs.
        eiv += eiv_unit_value(model) * (input.base_quantity as f64) * (runs as f64);
        materials.push(MaterialLine {
            type_id: input.type_id,
            name: input.name.clone(),
            required_quantity: required,
            have,
            unit_price,
            line_cost,
            built,
        });
    }

    let job_fee_amount = job_fee(eiv, config, step);

    // Revenue from selling the product.
    let units_produced = step.product_per_run * runs;
    let product_model = prices.get(&step.product_type_id);
    let product_volume = product_model.and_then(|m| m.daily_volume);
    let product_price = price_for(product_model, config.product_basis);
    let revenue = match product_price {
        Some(price) => {
            let gross = price * units_produced as f64;
            if config.include_sales_cost {
                gross * (1.0 - config.sales_tax - config.broker_fee)
            } else {
                gross
            }
        }
        None => {
            missing_prices.push(step.product_type_id);
            0.0
        }
    };

    let blueprint_cost = config.blueprint_cost_per_run * runs as f64;

    // Invention (T2): amortize the expected attempt cost over the runs it yields.
    let (invention_cost, invention) = match &step.invention {
        Some(inv) => {
            let mut datacore_lines = Vec::with_capacity(inv.datacores.len());
            let mut datacore_cost = 0.0;
            let mut invention_eiv = 0.0;
            for dc in &inv.datacores {
                let model = prices.get(&dc.type_id);
                let unit = price_for(model, config.material_basis);
                let line = match unit {
                    Some(p) => p * dc.base_quantity as f64,
                    None => {
                        missing_prices.push(dc.type_id);
                        0.0
                    }
                };
                datacore_cost += line;
                invention_eiv += eiv_unit_value(model) * dc.base_quantity as f64;
                datacore_lines.push(MaterialLine {
                    type_id: dc.type_id,
                    name: dc.name.clone(),
                    required_quantity: dc.base_quantity,
                    have: 0,
                    unit_price: unit,
                    line_cost: line,
                    built: false,
                });
            }
            // Invention job fee, using job_fee() like manufacturing. Approximation:
            // config.system_cost_index is the manufacturing cost index; invention
            // and copy jobs have their own per-activity cost indices in-game that
            // this engine doesn't fetch. Parameterize per-activity indices later
            // if/when they become available from ESI.
                        let invention_job_fee = job_fee(invention_eiv, config, &BuildStep {
                activity: Activity::Invention,
                ..step.clone()
            });
            // Copy job fee for the T1 BPC consumed each attempt: EIV of the T1
            // product run through job_fee(), same manufacturing-cost-index
            // approximation as invention_job_fee above.
            let copy_eiv: f64 = inv
                .copy_materials
                .iter()
                .map(|m| eiv_unit_value(prices.get(&m.type_id)) * m.base_quantity as f64)
                .sum();
                        let copy_fee = job_fee(copy_eiv, config, &BuildStep {
                activity: Activity::Invention,
                ..step.clone()
            });
            let attempt_cost = datacore_cost + invention_job_fee + copy_fee;
            let probability = (inv.probability * config.invention_skill_multiplier).min(1.0);
            let yielded = probability * inv.runs_per_success as f64;
            let per_unit = if yielded > 0.0 {
                attempt_cost / yielded
            } else {
                0.0
            };
            let breakdown = InventionBreakdown {
                datacores: datacore_lines,
                datacore_cost,
                invention_job_fee,
                copy_fee,
                attempt_cost,
                probability,
                runs_per_success: inv.runs_per_success,
                per_unit,
                base_blueprint_type_id: inv.base_blueprint_type_id,
                base_blueprint_name: String::new(),
            };
            (per_unit * runs as f64, Some(breakdown))
        }
        None => (0.0, None),
    };

    let cost = material_cost + job_fee_amount + blueprint_cost + invention_cost;
    let profit = revenue - cost;
    let margin = if revenue > 0.0 {
        Some(profit / revenue)
    } else {
        None
    };
    let roi = if cost > 0.0 {
        Some(profit / cost)
    } else {
        None
    };
    let profit_per_unit = if units_produced > 0 {
        profit / units_produced as f64
    } else {
        0.0
    };

    // Reaction install cost: sum of job fees for all Reaction sub-steps in the
    // build tree (reaction formulas nested under this manufacturing product).
    let reaction_install = sum_reaction_install_cost(step, prices, config, MAX_BUILD_DEPTH);

    ProfitBreakdown {
        blueprint_type_id: step.blueprint_type_id,
        product_type_id: step.product_type_id,
        product_name: step.product_name.clone(),
        runs,
        me: effective_me,
        job_time_seconds: 0.0,
        units_produced,
        material_cost,
        job_fee: job_fee_amount,
                manufacturing_cost_index: config.system_cost_index_for(Activity::Manufacturing),
        manufacturing_install_cost: job_fee_amount,
        manufacturing_time_seconds: 0.0,
        reaction_install_cost: reaction_install,
        reaction_time_seconds: 0.0,
        approximate: config.is_approximate(),
        blueprint_cost,
        invention_cost,
        invention,
        revenue,
        profit,
        margin,
        roi,
        profit_per_unit,
        meta_group: None,
        category: None,
        group: None,
        market: None,
        sell_hub: None,
        favorite: false,
        product_volume,
        product_price,
        materials,
        missing_prices,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-6, "expected {b}, got {a}");
    }

    fn price(
        type_id: i64,
        sell: Option<f64>,
        adjusted: Option<f64>,
        volume: Option<i64>,
    ) -> PriceModel {
        PriceModel {
            type_id,
            sell_min: sell,
            adjusted_price: adjusted,
            daily_volume: volume,
            ..Default::default()
        }
    }

    // Blueprint 999 -> 1x Widget(100) from 40x Trit(200) + 10x Pyerite(300).
    fn widget_step() -> BuildStep {
        BuildStep {
            activity: Activity::Manufacturing,
            blueprint_type_id: 999,
            product_type_id: 100,
            product_name: "Widget".into(),
            product_per_run: 1,
            inputs: vec![
                InputLine {
                    type_id: 200,
                    name: "Tritanium".into(),
                    base_quantity: 40,
                    sourcing: Sourcing::Buy,
                },
                InputLine {
                    type_id: 300,
                    name: "Pyerite".into(),
                    base_quantity: 10,
                    sourcing: Sourcing::Buy,
                },
            ],
            invention: None,
        }
    }

    fn widget_prices() -> HashMap<i64, PriceModel> {
        HashMap::from([
            (200, price(200, Some(5.0), Some(4.0), None)),
            (300, price(300, Some(10.0), Some(8.0), None)),
            (100, price(100, Some(1000.0), Some(900.0), Some(1200))),
        ])
    }

    #[test]
    fn required_quantity_applies_me_and_min_per_run() {
        assert_eq!(required_quantity(40, 1, 10, 1.0), 36); // ceil(36)
        assert_eq!(required_quantity(10, 1, 10, 1.0), 9); // ceil(9)
        assert_eq!(required_quantity(40, 1, 0, 1.0), 40); // no ME
        assert_eq!(required_quantity(1, 3, 10, 1.0), 3); // 2.7 -> ceil 3, also min runs
        assert_eq!(required_quantity(1, 5, 90, 1.0), 5); // 0.5 -> clamps up to runs
    }

    #[test]
    fn required_quantity_applies_structure_me_bonus() {
        // 1000 base at ME10 = 900; ×0.99 structure bonus = 891.
        assert_eq!(required_quantity(1000, 1, 10, 0.99), 891);
        // Bonus stacks on top of ME but never below runs.
        assert_eq!(required_quantity(1, 4, 0, 0.95), 4);
    }

        #[test]
    fn job_fee_adds_scc_and_cost_bonus() {
        let cfg = ProfitConfig {
            system_cost_index: 0.05,
            facility_tax: 0.01,
            cost_bonus: 0.03,
            scc_surcharge: 0.04,
            ..Default::default()
        };
        let step = BuildStep {
            activity: Activity::Manufacturing,
            blueprint_type_id: 0,
            product_type_id: 0,
            product_name: String::new(),
            product_per_run: 1,
            inputs: vec![],
            invention: None,
            is_component: false,
        };
        // 1000 EIV: 1000×0.05×0.97 + 1000×0.01 + 1000×0.04 = 48.5 + 10 + 40 = 98.5.
        assert!((job_fee(1000.0, &cfg, &step) - 98.5).abs() < 1e-9);
    }

    #[test]
    fn invention_and_copy_fees_include_scc_and_cost_bonus() {
        // T2 step: no manufacturing materials of its own (isolates the
        // invention/copy fee path); invention consumes 2x datacore (400) and
        // the copy job consumes 3x copy material (500).
        let step = BuildStep {
            activity: Activity::Manufacturing,
            blueprint_type_id: 998,
            product_type_id: 101,
            product_name: "T2 Widget".into(),
            product_per_run: 1,
            inputs: vec![],
            invention: Some(Invention {
                datacores: vec![InputLine {
                    type_id: 400,
                    name: "Datacore".into(),
                    base_quantity: 2,
                    sourcing: Sourcing::Buy,
                }],
                copy_materials: vec![InputLine {
                    type_id: 500,
                    name: "Copy Material".into(),
                    base_quantity: 3,
                    sourcing: Sourcing::Buy,
                }],
                runs_per_success: 1,
                probability: 1.0,
               result_me: 2,
               base_blueprint_type_id: 599,
           }),
            is_component: false,
       };
       let prices = HashMap::from([
            (400, price(400, Some(55.0), Some(50.0), None)),
            (500, price(500, Some(22.0), Some(20.0), None)),
            (101, price(101, Some(1.0), Some(1.0), None)),
        ]);

        // invention_eiv = 2*50 = 100; copy_eiv = 3*20 = 60.
        let cfg_with_bonus = ProfitConfig {
            system_cost_index: 0.05,
            facility_tax: 0.01,
            cost_bonus: 0.03,
            scc_surcharge: 0.04,
            ..Default::default()
        };
        let b = evaluate(&step, 1, 2, &prices, &cfg_with_bonus);
        let inv = b.invention.expect("invention breakdown present");
        // job_fee(100, cfg) = 100*0.05*0.97 + 100*0.01 + 100*0.04 = 4.85+1+4 = 9.85
        approx(inv.invention_job_fee, 9.85);
        // job_fee(60, cfg) = 60*0.05*0.97 + 60*0.01 + 60*0.04 = 2.91+0.6+2.4 = 5.91
        approx(inv.copy_fee, 5.91);

        // Without the surcharge/cost_bonus terms both fees must be lower —
        // proves invention_job_fee/copy_fee actually flow through job_fee()
        // rather than the old inline (index * (1 + facility_tax)) formula.
        let cfg_no_bonus = ProfitConfig {
            system_cost_index: 0.05,
            facility_tax: 0.01,
            cost_bonus: 0.0,
            scc_surcharge: 0.0,
            ..Default::default()
        };
        let b_no_bonus = evaluate(&step, 1, 2, &prices, &cfg_no_bonus);
        let inv_no_bonus = b_no_bonus.invention.expect("invention breakdown present");
        assert!(inv.invention_job_fee > inv_no_bonus.invention_job_fee);
        assert!(inv.copy_fee > inv_no_bonus.copy_fee);
    }

    #[test]
    fn hand_verified_profit() {
        let config = ProfitConfig {
            system_cost_index: 0.05,
            facility_tax: 0.1,
            ..Default::default()
        };
        let b = evaluate(&widget_step(), 1, 10, &widget_prices(), &config);

        // materials: 36*5 + 9*10 = 270
        approx(b.material_cost, 270.0);
        // EIV = 40*4 + 10*8 = 240; fee = 240*0.05 (sci) + 240*0.1 (tax) = 12 + 24 = 36.
        approx(b.job_fee, 36.0);
        approx(b.revenue, 1000.0);
        approx(b.profit, 694.0);
        approx(b.margin.unwrap(), 0.694);
        // ROI = profit / cost = 694 / (270 + 36).
        approx(b.roi.unwrap(), 694.0 / 306.0);
        approx(b.profit_per_unit, 694.0);
        assert_eq!(b.units_produced, 1);
        assert_eq!(b.product_volume, Some(1200));
        assert!(b.missing_prices.is_empty());
        assert_eq!(b.materials.len(), 2);
        approx(b.materials[0].line_cost, 180.0);
    }

    #[test]
    fn stock_covers_the_shortfall_only() {
        // Own all 36 Tritanium (type 200) needed at ME10; pay only for Pyerite.
        let stock = HashMap::from([(200_i64, 100_i64)]);
        let b = evaluate_with_stock(
            &widget_step(),
            1,
            10,
            &widget_prices(),
            &ProfitConfig::default(),
            &stock,
        );
        // Trit line: have 36, cost 0; Pyerite: 9 × 10 = 90.
        approx(b.materials[0].line_cost, 0.0);
        assert_eq!(b.materials[0].have, 36);
        approx(b.materials[1].line_cost, 90.0);
        approx(b.material_cost, 90.0);
    }

    fn buildable_step() -> (BuildStep, HashMap<i64, PriceModel>) {
        // Product 100 needs 1× A(10); A is buildable from 2× B(20).
        let sub = BuildStep {
            activity: Activity::Manufacturing,
            blueprint_type_id: 11,
            product_type_id: 10,
            product_name: "A".into(),
            product_per_run: 1,
            inputs: vec![InputLine {
                type_id: 20,
                name: "B".into(),
                base_quantity: 2,
                sourcing: Sourcing::Buy,
               }],
               invention: None,
               is_component: false,
           };
           let step = BuildStep {
            activity: Activity::Manufacturing,
            blueprint_type_id: 1,
            product_type_id: 100,
            product_name: "P".into(),
            product_per_run: 1,
            inputs: vec![InputLine {
                type_id: 10,
                name: "A".into(),
                base_quantity: 1,
               sourcing: Sourcing::Build(Box::new(sub)),
           }],
           invention: None,
            is_component: false,
       };
       let prices = HashMap::from([
            (10, price(10, Some(100.0), Some(100.0), None)),
            (20, price(20, Some(10.0), Some(10.0), None)),
            (100, price(100, Some(1000.0), Some(900.0), None)),
        ]);
        (step, prices)
    }

    #[test]
    fn recursive_build_wins_when_cheaper() {
        let (step, prices) = buildable_step();
        // Build A = 2×B(10) = 20 < buy A (100).
        let b = evaluate(&step, 1, 0, &prices, &ProfitConfig::default());
        assert!(b.materials[0].built);
        approx(b.materials[0].line_cost, 20.0);
        approx(b.material_cost, 20.0);
    }

    #[test]
    fn recursive_buy_wins_when_cheaper() {
        let (step, mut prices) = buildable_step();
        // Make B expensive so building A (2×200=400) costs more than buying (100).
        prices.insert(20, price(20, Some(200.0), Some(200.0), None));
        let b = evaluate(&step, 1, 0, &prices, &ProfitConfig::default());
        assert!(!b.materials[0].built);
        approx(b.materials[0].line_cost, 100.0);
    }

    #[test]
    fn invention_cost_is_amortized() {
        let mut step = widget_step();
        step.invention = Some(Invention {
            datacores: vec![InputLine {
                type_id: 500,
                name: "Datacore".into(),
                base_quantity: 2,
                sourcing: Sourcing::Buy,
            }],
            copy_materials: vec![],
            runs_per_success: 10,
            probability: 0.5,
            result_me: 10,
            base_blueprint_type_id: 599,
        });
        let mut prices = widget_prices();
        prices.insert(500, price(500, Some(100.0), Some(100.0), None));
        // Default config: SellMin basis, cost index 0 (no invention job fee).
        let b = evaluate(&step, 1, 10, &prices, &ProfitConfig::default());
        // attempt = 2 datacores × 100 = 200; per mfg-run = 200 / (0.5 × 10) = 40.
        approx(b.invention_cost, 40.0);
        // profit = 1000 − materials 270 − invention 40
        approx(b.profit, 1000.0 - 270.0 - 40.0);
        let inv = b.invention.unwrap();
        approx(inv.datacore_cost, 200.0);
        approx(inv.per_unit, 40.0);
        assert_eq!(inv.datacores.len(), 1);
        // Propagates from the step's Invention (name is backfilled by the
        // command layer from the SDE, not the pure engine — stays empty here).
        assert_eq!(inv.base_blueprint_type_id, 599);
        assert_eq!(inv.base_blueprint_name, "");
    }

    #[test]
    fn blueprint_cost_per_run_reduces_profit() {
        let config = ProfitConfig {
            blueprint_cost_per_run: 100.0,
            ..Default::default()
        };
        let b = evaluate(&widget_step(), 1, 10, &widget_prices(), &config);
        approx(b.blueprint_cost, 100.0);
        // materials 270, no job fee (index 0), blueprint 100 -> profit 630
        approx(b.profit, 1000.0 - 270.0 - 100.0);
    }

    #[test]
    fn missing_material_price_is_flagged_not_zero_cost_silent() {
        let mut prices = widget_prices();
        prices.remove(&300); // Pyerite unpriced
        let b = evaluate(&widget_step(), 1, 10, &prices, &ProfitConfig::default());
        assert_eq!(b.missing_prices, vec![300]);
        // Only Tritanium counted: 36*5 = 180
        approx(b.material_cost, 180.0);
        assert_eq!(b.materials[1].unit_price, None);
        approx(b.materials[1].line_cost, 0.0);
    }

    #[test]
    fn missing_product_price_flags_and_yields_no_revenue() {
        let mut prices = widget_prices();
        prices.remove(&100); // product unpriced
        let b = evaluate(&widget_step(), 1, 10, &prices, &ProfitConfig::default());
        assert!(b.missing_prices.contains(&100));
        approx(b.revenue, 0.0);
        assert!(b.margin.is_none());
        // profit is negative cost, not a silent zero
        assert!(b.profit < 0.0);
    }

    #[test]
    fn scales_with_runs() {
        let b = evaluate(
            &widget_step(),
            10,
            0,
            &widget_prices(),
            &ProfitConfig::default(),
        );
        assert_eq!(b.units_produced, 10);
        // no ME: 400*5 + 100*10 = 3000
        approx(b.material_cost, 3000.0);
        approx(b.revenue, 10_000.0);
    }

    #[test]
    fn facility_profile_from_structure_composes_me_bonus() {
        // Raitaru (ME 0.99) + 1 Medium Manufacturing Material Rig I (4% ME)
        // → me_bonus = 0.99 * (1 - 4/100) = 0.9504
        let profile = FacilityProfile::from_structure(
            FacilityType::Manufacturing,
            StructureType::Raitaru,
            SecurityTier::Highsec,
            vec![1957], // Medium Manufacturing Material Rig I (4% ME)
            Some(0.05),
            Some(0.0),
        );
        approx(profile.me_bonus, 0.99 * (1.0 - 4.0 / 100.0));
        approx(profile.cost_bonus, 0.03); // 3% structure, 0% rig
        approx(profile.te_bonus_pct, 15.0); // Raitaru base TE 15%
        assert!(!profile.is_approximate());
    }

    #[test]
    fn tatara_profile_has_role_bonus_time_and_is_approximate_for_wh() {
        let profile = FacilityProfile::from_structure(
            FacilityType::Reaction,
            StructureType::Tatara,
            SecurityTier::Wormhole,
            vec![],
            None,
            None,
        );
        approx(profile.role_bonus_time, 0.25);
        assert!(profile.is_approximate());
        approx(profile.cost_index_or_zero(), 0.0);
        approx(profile.tax_or_zero(), 0.0);
    }

    #[test]
    fn facility_profiles_select_by_activity() {
        let profiles = FacilityProfiles {
            manufacturing: FacilityProfile::from_structure(
                FacilityType::Manufacturing,
                StructureType::Raitaru,
                SecurityTier::Highsec,
                vec![],
                Some(0.05),
                Some(0.0),
            ),
           reaction: FacilityProfile::from_structure(
               FacilityType::Reaction,
               StructureType::Tatara,
               SecurityTier::Nullsec,
               vec![],
               Some(0.08),
               Some(0.1),
           ),
           components: FacilityProfile::default(),
       };
        assert_eq!(
            profiles.for_activity(Activity::Manufacturing).structure,
            StructureType::Raitaru,
        );
        assert_eq!(
            profiles.for_activity(Activity::Reaction).structure,
            StructureType::Tatara,
        );
    }

    #[test]
    fn me_bonus_for_selects_profile_vs_flat_fallback() {
        let profiles = FacilityProfiles {
            manufacturing: FacilityProfile::from_structure(
                FacilityType::Manufacturing,
                StructureType::Raitaru,
                SecurityTier::Highsec,
                vec![],
                Some(0.05),
                Some(0.0),
            ),
           reaction: FacilityProfile::from_structure(
               FacilityType::Reaction,
               StructureType::Tatara,
               SecurityTier::Nullsec,
               vec![],
               Some(0.08),
               Some(0.1),
           ),
           components: FacilityProfile::default(),
       };
       let config = ProfitConfig {
           facility_profiles: Some(profiles),
           ..Default::default()
       };
        approx(config.me_bonus_for(Activity::Manufacturing), 0.99);
        approx(config.te_bonus_pct_for(Activity::Manufacturing), 15.0);
        approx(config.role_bonus_time_for(Activity::Reaction), 0.25);

        let flat = ProfitConfig {
            facility_profiles: None,
            me_bonus: 0.95,
            structure_te_pct: 10.0,
            ..Default::default()
        };
        approx(flat.me_bonus_for(Activity::Manufacturing), 0.95);
    }

    #[test]
    fn job_fee_uses_activity_specific_profile() {
        let profiles = FacilityProfiles {
            manufacturing: FacilityProfile::from_structure(
                FacilityType::Manufacturing,
                StructureType::Raitaru,
                SecurityTier::Highsec,
                vec![],
                Some(0.05),
                Some(0.0),
            ),
           reaction: FacilityProfile::from_structure(
               FacilityType::Reaction,
               StructureType::Tatara,
               SecurityTier::Nullsec,
               vec![],
               Some(0.08),
               Some(0.1),
           ),
           components: FacilityProfile::default(),
       };
       let config = ProfitConfig {
           facility_profiles: Some(profiles),
            scc_surcharge: 0.04,
            ..Default::default()
        };
                        let mfg_step = BuildStep {
            activity: Activity::Manufacturing,
            blueprint_type_id: 0,
            product_type_id: 0,
            product_name: String::new(),
            product_per_run: 1,
            inputs: vec![],
            invention: None,
            is_component: false,
        };
        let mfg_fee = job_fee(1000.0, &config, &mfg_step);
        // 1000×0.05×(1−0.03) + 0 + 1000×0.04 = 48.5 + 40 = 88.5
        approx(mfg_fee, 88.5);
        let rxn_step = BuildStep {
            activity: Activity::Reaction,
            blueprint_type_id: 0,
            product_type_id: 0,
            product_name: String::new(),
            product_per_run: 1,
            inputs: vec![],
            invention: None,
            is_component: false,
        };
        let rxn_fee = job_fee(1000.0, &config, &rxn_step);
        approx(rxn_fee, 216.0);
    }

    #[test]
    fn sum_reaction_install_cost_sums_sub_build_reaction_fees() {
        let rxn_sub = BuildStep {
            activity: Activity::Reaction,
            blueprint_type_id: 5000,
            product_type_id: 600,
            product_name: "Booster".into(),
            product_per_run: 1,
            inputs: vec![InputLine {
                type_id: 200,
                name: "Tritanium".into(),
                base_quantity: 10,
               sourcing: Sourcing::Buy,
           }],
           invention: None,
            is_component: false,
       };
       let step = BuildStep {
            activity: Activity::Manufacturing,
            blueprint_type_id: 999,
            product_type_id: 100,
            product_name: "Widget".into(),
            product_per_run: 1,
            inputs: vec![InputLine {
                type_id: 600,
                name: "Booster".into(),
                base_quantity: 2,
               sourcing: Sourcing::Build(Box::new(rxn_sub)),
           }],
           invention: None,
            is_component: false,
       };
       let config = ProfitConfig {
            system_cost_index: 0.05,
            facility_tax: 0.01,
            cost_bonus: 0.03,
            scc_surcharge: 0.04,
            ..Default::default()
        };
        // EIV = 10 × 4 = 40; fee = 40×0.05×0.97 + 40×0.01 + 40×0.04 = 3.94
        let rc = sum_reaction_install_cost(&step, &widget_prices(), &config, MAX_BUILD_DEPTH);
                approx(rc, 3.94);
    }

    #[test]
    fn processing_rigs_are_recognized() {
        // Medium Processing Time Rig I (1967) → 4% TE
        let b = rig_bonus_lookup(1967).expect("should find rig 1967");
        assert_eq!(b.te_pct, 4.0);
        assert!(!b.is_t2);

        // Medium Processing Material Rig II (1970) → 5% ME, T2
        let b = rig_bonus_lookup(1970).expect("should find rig 1970");
        assert_eq!(b.me_pct, 5.0);
        assert!(b.is_t2);

        // Medium Processing Cost Rig I (1971) → 3% cost
        let b = rig_bonus_lookup(1971).expect("should find rig 1971");
        assert_eq!(b.cost_pct, 3.0);

        // Small Processing Time Rig I (1973) → 2% TE
        let b = rig_bonus_lookup(1973).expect("should find rig 1973");
        assert_eq!(b.te_pct, 2.0);

        // Unknown ID
        assert!(rig_bonus_lookup(99999).is_none());
    }

    #[test]
    fn rig_bonuses_from_ids_sums_processing_rigs() {
        // 1967 (4% TE) + 1969 (4% ME) + 1971 (3% cost) at Highsec
        let (me, te, cost) = rig_bonuses_from_ids(
            &[1967, 1969, 1971],
            SecurityTier::Highsec,
        );
        approx(te, 4.0); // 4% TE
        approx(me, 0.96); // 1 - 4% ME
        approx(cost, 0.03); // 3% cost
    }

    #[test]
    fn t2_processing_rig_scaled_by_security() {
        // Medium Processing Time Rig II (1968): 5% TE at full security
        let (_, te_null, _) = rig_bonuses_from_ids(&[1968], SecurityTier::Nullsec);
        approx(te_null, 5.0); // 100% multiplier

        let (_, te_high, _) = rig_bonuses_from_ids(&[1968], SecurityTier::Highsec);
        approx(te_high, 2.5); // 50% multiplier → 2.5%

        let (_, te_wh, _) = rig_bonuses_from_ids(&[1968], SecurityTier::Wormhole);
        approx(te_wh, 7.5); // 150% multiplier → 7.5%
    }

    #[test]
    fn implant_bonuses_stack_on_facility() {
        let profiles = FacilityProfiles {
            manufacturing: FacilityProfile::from_structure(
                FacilityType::Manufacturing,
                StructureType::Raitaru,
                SecurityTier::Highsec,
                vec![],
                Some(0.05),
                Some(0.0),
            ),
            reaction: FacilityProfile::default(),
            components: FacilityProfile::default(),
        };
        let step = BuildStep {
            activity: Activity::Manufacturing,
            blueprint_type_id: 0,
            product_type_id: 0,
            product_name: String::new(),
            product_per_run: 1,
            inputs: vec![],
            invention: None,
            is_component: false,
        };

        // No implant → Raitaru base: 15% TE
        let config = ProfitConfig {
            facility_profiles: Some(profiles.clone()),
            ..Default::default()
        };
        approx(config.te_bonus_pct_for_step(&step), 15.0);

        // With implant (4% time) → 15 + 4 = 19% TE
        let config = ProfitConfig {
            facility_profiles: Some(profiles),
            implant: Some(ImplantBonus {
                time_bonus_pct: 4.0,
                material_bonus: 1.0,
                cost_bonus_pct: 0.0,
            }),
            ..Default::default()
        };
        approx(config.te_bonus_pct_for_step(&step), 19.0);
    }

    #[test]
    fn implant_material_bonus_multiplies_facility_me() {
        let profiles = FacilityProfiles {
            manufacturing: FacilityProfile::from_structure(
                FacilityType::Manufacturing,
                StructureType::Raitaru,
                SecurityTier::Highsec,
                vec![1955], // 2% ME rig
                Some(0.05),
                Some(0.0),
            ),
            reaction: FacilityProfile::default(),
            components: FacilityProfile::default(),
        };
        let step = BuildStep {
            activity: Activity::Manufacturing,
            blueprint_type_id: 0,
            product_type_id: 0,
            product_name: String::new(),
            product_per_run: 1,
            inputs: vec![],
            invention: None,
            is_component: false,
        };

        // Raitaru (0.99) + rig 1955 (2% ME) + T1 @ Highsec (1.0) = 0.99 * 0.98 = 0.9702
        // Then implant material_bonus 0.99 → 0.9702 * 0.99 = 0.960498
        let config = ProfitConfig {
            facility_profiles: Some(profiles),
            implant: Some(ImplantBonus {
                time_bonus_pct: 0.0,
                material_bonus: 0.99,
                cost_bonus_pct: 0.0,
            }),
            ..Default::default()
        };
        let r = config.me_bonus_for_step(&step);
                approx(r, 0.9702 * 0.99);
    }
}
