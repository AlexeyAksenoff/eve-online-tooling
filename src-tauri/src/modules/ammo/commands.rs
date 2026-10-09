//! Tauri command surface for the ammo reference table.
//!
//! The SQL (attribute reads, size filter, group-name resolution) lives in
//! `sde::db::ammo::Sde::ammo_charges` — this file only classifies the raw
//! rows it returns into a tier (T1/Navy/T2) and, for T2, the turret class
//! it's restricted to, then shapes the response the frontend renders.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::sde::AmmoChargeAttrs;

/// Which turret family's charges to list. Each has its own T1 "base" group
/// plus two T2-specific groups in the SDE.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AmmoFamily {
    Hybrid,
    Projectile,
    Laser,
}

impl AmmoFamily {
    /// The three `invGroups.groupName` values this family's charges live in:
    /// the T1/Navy "base" group, then the two turret-specific T2 groups.
    /// Resolved by name (never a hardcoded group id) — confirmed against the
    /// live SDE's `invGroups` (categoryID 8, Charge).
    fn group_names(self) -> [&'static str; 3] {
        match self {
            AmmoFamily::Hybrid => [
                "Hybrid Charge",
                "Advanced Blaster Charge",
                "Advanced Railgun Charge",
            ],
            AmmoFamily::Projectile => [
                "Projectile Ammo",
                "Advanced Autocannon Ammo",
                "Advanced Artillery Ammo",
            ],
            AmmoFamily::Laser => [
                "Frequency Crystal",
                "Advanced Pulse Laser Crystal",
                "Advanced Beam Laser Crystal",
            ],
        }
    }

    /// Projectile ammo carries no `capNeedBonus` attribute at all (autocannons
    /// and artillery don't use capacitor) — the cap-need column is hybrid and
    /// laser only, per spec.
    fn has_cap_need_column(self) -> bool {
        !matches!(self, AmmoFamily::Projectile)
    }
}

/// A T2 group name's turret-class restriction. T1/Navy charges come from a
/// family's shared "base" group (e.g. "Hybrid Charge"), which isn't in this
/// table, so they naturally resolve to `None` — they fit both turret types
/// in the family.
fn turret_class(group_name: &str) -> Option<&'static str> {
    match group_name {
        "Advanced Blaster Charge" => Some("Blaster"),
        "Advanced Railgun Charge" => Some("Railgun"),
        "Advanced Autocannon Ammo" => Some("Autocannon"),
        "Advanced Artillery Ammo" => Some("Artillery"),
        "Advanced Pulse Laser Crystal" => Some("Pulse"),
        "Advanced Beam Laser Crystal" => Some("Beam"),
        _ => None,
    }
}

/// The four empire navies' name prefixes — used to separate "Navy" ammo from
/// pirate-faction ammo, which also lives under `invMetaGroups` id 4
/// (Faction) and isn't part of this reference. Verified against the live SDE:
/// these four prefixes exactly cover the navy small charges with no overlap
/// against Angel/Blood/Guristas/Sansha/etc.
const NAVY_PREFIXES: [&str; 4] = [
    "Caldari Navy",
    "Federation Navy",
    "Republic Fleet",
    "Imperial Navy",
];

/// Tier classification from `invMetaTypes.metaGroupID` (+ name, for Navy):
/// `None`/`Some(1)` = Tech I, `Some(2)` = Tech II, `Some(4)` with a navy name
/// prefix = Navy. Anything else (pirate-faction ammo at meta group 4,
/// Storyline/Officer/Deadspace/Abyssal variants) is out of scope for this
/// quick reference and returns `None`.
fn classify_tier(meta_group_id: Option<i64>, name: &str) -> Option<&'static str> {
    match meta_group_id {
        None | Some(1) => Some("T1"),
        Some(2) => Some("T2"),
        Some(4) if NAVY_PREFIXES.iter().any(|p| name.starts_with(p)) => Some("Navy"),
        _ => None,
    }
}

/// One row of the ammo reference table.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AmmoRow {
    pub type_id: i64,
    pub name: String,
    /// "T1" | "Navy" | "T2".
    pub tier: String,
    pub family: AmmoFamily,
    /// The turret class this charge is restricted to — only set for T2
    /// rows; T1/Navy charges fit either turret in the family.
    pub turret_class: Option<String>,
    pub em: f64,
    pub thermal: f64,
    pub kinetic: f64,
    pub explosive: f64,
    pub total_damage: f64,
    pub optimal_mult: f64,
    pub falloff_mult: f64,
    pub tracking_mult: f64,
    /// Percent cap-use bonus (`25.0` = +25%), `None` for Projectile (which
    /// never carries this attribute — autocannons/artillery don't use cap).
    pub cap_need_bonus_pct: Option<f64>,
}

/// Classify one raw SDE row into a reference row, or drop it (pirate-faction
/// ammo and other out-of-scope meta groups).
fn build_row(family: AmmoFamily, a: AmmoChargeAttrs) -> Option<AmmoRow> {
    let tier = classify_tier(a.meta_group_id, &a.name)?;
    Some(AmmoRow {
        type_id: a.type_id,
        name: a.name,
        tier: tier.to_string(),
        family,
        turret_class: turret_class(&a.group_name).map(str::to_string),
        total_damage: a.em + a.explosive + a.kinetic + a.thermal,
        em: a.em,
        thermal: a.thermal,
        kinetic: a.kinetic,
        explosive: a.explosive,
        optimal_mult: a.optimal_mult,
        falloff_mult: a.falloff_mult,
        tracking_mult: a.tracking_mult,
        cap_need_bonus_pct: family.has_cap_need_column().then_some(a.cap_need_bonus_pct),
    })
}

/// The Small turret charge reference table for one family, covering its T1,
/// Navy and T2 tiers.
#[tauri::command]
pub fn ammo_reference(app: AppHandle, family: AmmoFamily) -> Result<Vec<AmmoRow>, String> {
    let sde = crate::sde::open_from_app(&app)?;
    let raw = sde
        .ammo_charges(&family.group_names())
        .map_err(|e| e.to_string())?;
    Ok(raw
        .into_iter()
        .filter_map(|a| build_row(family, a))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attrs(name: &str, group_name: &str, meta_group_id: Option<i64>) -> AmmoChargeAttrs {
        AmmoChargeAttrs {
            type_id: 1,
            name: name.to_string(),
            group_name: group_name.to_string(),
            meta_group_id,
            em: 0.0,
            explosive: 0.0,
            kinetic: 8.9,
            thermal: 8.9,
            optimal_mult: 0.75,
            falloff_mult: 0.5,
            tracking_mult: 0.75,
            cap_need_bonus_pct: 25.0,
        }
    }

    #[test]
    fn t1_has_no_meta_group_row() {
        assert_eq!(classify_tier(None, "Antimatter Charge S"), Some("T1"));
        assert_eq!(classify_tier(Some(1), "Antimatter Charge S"), Some("T1"));
    }

    #[test]
    fn navy_requires_meta_group_four_and_a_navy_prefix() {
        assert_eq!(
            classify_tier(Some(4), "Caldari Navy Antimatter Charge S"),
            Some("Navy")
        );
        assert_eq!(classify_tier(Some(4), "Republic Fleet EMP S"), Some("Navy"));
    }

    #[test]
    fn pirate_faction_ammo_is_excluded() {
        assert_eq!(classify_tier(Some(4), "Guristas Antimatter Charge S"), None);
        assert_eq!(classify_tier(Some(4), "Dread Guristas Void S"), None);
    }

    #[test]
    fn t2_is_meta_group_two() {
        assert_eq!(classify_tier(Some(2), "Void S"), Some("T2"));
    }

    #[test]
    fn other_meta_groups_are_out_of_scope() {
        // Storyline (3), Officer (5), Deadspace (6), Abyssal (15), etc.
        assert_eq!(classify_tier(Some(3), "Civilian Antimatter Charge S"), None);
        assert_eq!(classify_tier(Some(5), "Dread Guristas' Void S"), None);
    }

    #[test]
    fn t2_group_names_map_to_their_turret_class() {
        assert_eq!(turret_class("Advanced Blaster Charge"), Some("Blaster"));
        assert_eq!(turret_class("Advanced Railgun Charge"), Some("Railgun"));
        assert_eq!(turret_class("Advanced Autocannon Ammo"), Some("Autocannon"));
        assert_eq!(turret_class("Advanced Artillery Ammo"), Some("Artillery"));
        assert_eq!(turret_class("Advanced Pulse Laser Crystal"), Some("Pulse"));
        assert_eq!(turret_class("Advanced Beam Laser Crystal"), Some("Beam"));
    }

    #[test]
    fn t1_and_navy_base_groups_have_no_turret_class() {
        assert_eq!(turret_class("Hybrid Charge"), None);
        assert_eq!(turret_class("Projectile Ammo"), None);
        assert_eq!(turret_class("Frequency Crystal"), None);
    }

    #[test]
    fn build_row_sums_total_damage_and_tags_tier_and_turret_class() {
        let row = build_row(
            AmmoFamily::Hybrid,
            attrs("Void S", "Advanced Blaster Charge", Some(2)),
        )
        .unwrap();
        assert_eq!(row.tier, "T2");
        assert_eq!(row.turret_class.as_deref(), Some("Blaster"));
        assert_eq!(row.total_damage, 17.8);
        assert_eq!(row.cap_need_bonus_pct, Some(25.0));
    }

    #[test]
    fn projectile_family_never_exposes_a_cap_need_value() {
        let row = build_row(
            AmmoFamily::Projectile,
            attrs("EMP S", "Projectile Ammo", None),
        )
        .unwrap();
        assert_eq!(row.cap_need_bonus_pct, None);
    }

    #[test]
    fn pirate_rows_are_dropped_entirely() {
        assert!(build_row(
            AmmoFamily::Hybrid,
            attrs("Guristas Antimatter Charge S", "Hybrid Charge", Some(4)),
        )
        .is_none());
    }
}
