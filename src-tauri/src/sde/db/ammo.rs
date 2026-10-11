use rusqlite::params;

use super::super::types::AmmoChargeAttrs;
use super::super::SdeError;
use super::Sde;

impl Sde {
    /// Small (`chargeSize` = 1) published turret charges whose `invGroups`
    /// group name is one of `group_names` — resolved by name against
    /// `invGroups.groupName` at query time, never a hardcoded group id, so
    /// this keeps working across an SDE group-id renumbering. Category is
    /// pinned to 8 (Charge) as a defensive belt-and-braces check even though
    /// the caller's group names are already charge-only.
    ///
    /// Reads the raw damage/multiplier dogma attributes a charge carries —
    /// `em`/`explosive`/`kinetic`/`thermal`Damage (114/116/117/118),
    /// `weaponRangeMultiplier` (120), `fallofMultiplier` (517, SDE's own
    /// spelling — one "l"), `trackingSpeedMultiplier` (244) and
    /// `capNeedBonus` (317). Damage types absent on a charge (e.g. a
    /// kinetic-only hybrid round has no `emDamage` row at all) default to
    /// `0.0`; the three multiplier attributes default to `1.0` — the same
    /// dogma default the fitting engine's `AttrStore::get_or` relies on, so
    /// an unresearched/un-reloaded charge's missing attribute reads as a
    /// no-op rather than zeroing the stat. `capNeedBonus` defaults to `0.0`
    /// (no bonus) — it is a percent *add*, not a multiplier, despite the
    /// similarly-named `capacitorNeedMultiplier` (216): confirmed against
    /// the live SDE that zero charges carry 216, while every cap-affecting
    /// charge (Void, Conflagration, …) carries 317.
    ///
    /// No tier (T1/Navy/T2) or turret-class classification here — that's
    /// `modules::ammo`'s job, reading `meta_group_id` + `name` off the
    /// returned rows; this function only resolves what the SDE itself says.
    pub fn ammo_charges(&self, group_names: &[&str; 3]) -> Result<Vec<AmmoChargeAttrs>, SdeError> {
        let mut stmt = self.conn.prepare(
            "SELECT
               t.typeID,
               t.typeName,
               g.groupName,
               mt.metaGroupID,
               COALESCE(em.valueFloat, 0.0),
               COALESCE(ex.valueFloat, 0.0),
               COALESCE(kin.valueFloat, 0.0),
               COALESCE(th.valueFloat, 0.0),
               COALESCE(opt.valueFloat, 1.0),
               COALESCE(fall.valueFloat, 1.0),
               COALESCE(trk.valueFloat, 1.0),
               COALESCE(cap.valueFloat, 0.0)
             FROM invTypes t
             JOIN invGroups g ON g.groupID = t.groupID
             -- chargeSize = 1 (Small) — inner join: a charge with no size
             -- attribute at all isn't a sized turret round.
             JOIN dgmTypeAttributes sz
               ON sz.typeID = t.typeID AND sz.attributeID = 128 AND sz.valueFloat = 1
             LEFT JOIN invMetaTypes mt ON mt.typeID = t.typeID
             LEFT JOIN dgmTypeAttributes em ON em.typeID = t.typeID AND em.attributeID = 114
             LEFT JOIN dgmTypeAttributes ex ON ex.typeID = t.typeID AND ex.attributeID = 116
             LEFT JOIN dgmTypeAttributes kin ON kin.typeID = t.typeID AND kin.attributeID = 117
             LEFT JOIN dgmTypeAttributes th ON th.typeID = t.typeID AND th.attributeID = 118
             LEFT JOIN dgmTypeAttributes opt ON opt.typeID = t.typeID AND opt.attributeID = 120
             LEFT JOIN dgmTypeAttributes fall ON fall.typeID = t.typeID AND fall.attributeID = 517
             LEFT JOIN dgmTypeAttributes trk ON trk.typeID = t.typeID AND trk.attributeID = 244
             LEFT JOIN dgmTypeAttributes cap ON cap.typeID = t.typeID AND cap.attributeID = 317
             WHERE t.published = 1
               AND g.categoryID = 8
               AND g.groupName IN (?1, ?2, ?3)
             ORDER BY t.typeName",
        )?;
        let rows = stmt.query_map(
            params![group_names[0], group_names[1], group_names[2]],
            |r| {
                Ok(AmmoChargeAttrs {
                    type_id: r.get(0)?,
                    name: r.get(1)?,
                    group_name: r.get(2)?,
                    meta_group_id: r.get(3)?,
                    em: r.get(4)?,
                    explosive: r.get(5)?,
                    kinetic: r.get(6)?,
                    thermal: r.get(7)?,
                    optimal_mult: r.get(8)?,
                    falloff_mult: r.get(9)?,
                    tracking_mult: r.get(10)?,
                    cap_need_bonus_pct: r.get(11)?,
                })
            },
        )?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_sde;

    /// A tiny ammo-shaped fixture: two T1 hybrid charges (one Small, one
    /// Medium — exercises the size filter), a T2 (meta 2) and a Navy-named
    /// faction (meta 4) charge, plus a non-charge control row that must
    /// never surface (wrong category).
    fn fixture() -> super::Sde {
        test_sde(
            "CREATE TABLE invGroups(groupID INT, categoryID INT, groupName TEXT);
             CREATE TABLE invTypes(typeID INT, groupID INT, typeName TEXT, published INT);
             CREATE TABLE dgmTypeAttributes(typeID INT, attributeID INT, valueFloat REAL);
             CREATE TABLE invMetaTypes(typeID INT, parentTypeID INT, metaGroupID INT);

             INSERT INTO invGroups VALUES
               (85, 8, 'Hybrid Charge'),
               (377, 8, 'Advanced Blaster Charge'),
               (373, 8, 'Advanced Railgun Charge'),
               (10, 7, 'Not A Charge Group');

             INSERT INTO invTypes VALUES
               (1, 85, 'Antimatter Charge S', 1),
               (2, 85, 'Antimatter Charge M', 1),
               (3, 377, 'Void S', 1),
               (4, 85, 'Caldari Navy Antimatter Charge S', 1),
               (5, 85, 'Unpublished Round S', 0),
               (9, 10, 'Some Module', 1);

             -- #1 Antimatter S: Small, kin 7 + therm 5, no multipliers at all.
             INSERT INTO dgmTypeAttributes VALUES
               (1, 128, 1), (1, 117, 7.0), (1, 118, 5.0);
             -- #2 Antimatter M: Medium — must be excluded by the size filter.
             INSERT INTO dgmTypeAttributes VALUES
               (2, 128, 2), (2, 117, 7.0), (2, 118, 5.0);
             -- #3 Void S: Small T2, full multiplier set + cap need bonus.
             INSERT INTO dgmTypeAttributes VALUES
               (3, 128, 1), (3, 117, 8.9), (3, 118, 8.9),
               (3, 120, 0.75), (3, 517, 0.5), (3, 244, 0.75), (3, 317, 25.0);
             INSERT INTO invMetaTypes VALUES (3, NULL, 2);
             -- #4 Navy-named faction charge, Small.
             INSERT INTO dgmTypeAttributes VALUES
               (4, 128, 1), (4, 117, 8.0), (4, 118, 6.0);
             INSERT INTO invMetaTypes VALUES (4, NULL, 4);
             -- #5 Unpublished — must never surface.
             INSERT INTO dgmTypeAttributes VALUES (5, 128, 1), (5, 117, 99.0);",
        )
    }

    #[test]
    fn selects_only_the_named_groups_small_and_published() {
        let sde = fixture();
        let rows = sde
            .ammo_charges(&[
                "Hybrid Charge",
                "Advanced Blaster Charge",
                "Advanced Railgun Charge",
            ])
            .unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "Antimatter Charge S",
                "Caldari Navy Antimatter Charge S",
                "Void S",
            ],
            "Medium round, unpublished round and the non-charge group row must all be excluded"
        );
    }

    #[test]
    fn missing_multiplier_attributes_default_to_one() {
        let sde = fixture();
        let rows = sde
            .ammo_charges(&[
                "Hybrid Charge",
                "Advanced Blaster Charge",
                "Advanced Railgun Charge",
            ])
            .unwrap();
        let antimatter = rows
            .iter()
            .find(|r| r.name == "Antimatter Charge S")
            .unwrap();
        assert_eq!(antimatter.optimal_mult, 1.0);
        assert_eq!(antimatter.falloff_mult, 1.0);
        assert_eq!(antimatter.tracking_mult, 1.0);
        assert_eq!(antimatter.cap_need_bonus_pct, 0.0);
        assert_eq!(antimatter.kinetic, 7.0);
        assert_eq!(antimatter.thermal, 5.0);
        assert_eq!(antimatter.em, 0.0);
        assert_eq!(antimatter.explosive, 0.0);
        assert_eq!(antimatter.meta_group_id, None);
    }

    #[test]
    fn present_multipliers_and_meta_group_are_read_through() {
        let sde = fixture();
        let rows = sde
            .ammo_charges(&[
                "Hybrid Charge",
                "Advanced Blaster Charge",
                "Advanced Railgun Charge",
            ])
            .unwrap();
        let void = rows.iter().find(|r| r.name == "Void S").unwrap();
        assert_eq!(void.optimal_mult, 0.75);
        assert_eq!(void.falloff_mult, 0.5);
        assert_eq!(void.tracking_mult, 0.75);
        assert_eq!(void.cap_need_bonus_pct, 25.0);
        assert_eq!(void.meta_group_id, Some(2));
        assert_eq!(void.group_name, "Advanced Blaster Charge");

        let navy = rows
            .iter()
            .find(|r| r.name == "Caldari Navy Antimatter Charge S")
            .unwrap();
        assert_eq!(navy.meta_group_id, Some(4));
    }
}
