use rusqlite::params;
use std::collections::HashMap;

use super::super::types::SystemInfo;
use super::super::SdeError;
use super::Sde;

/// A solar system's `(regionID, x, y, z)` — region id plus 3D metre coordinates.
pub type SystemGeo = (i64, f64, f64, f64);

impl Sde {
    /// Search solar systems by name substring (case-insensitive), capped. For
    /// the route neighbourhood picker.
    pub fn search_systems(&self, query: &str, limit: i64) -> Result<Vec<(i64, String)>, SdeError> {
        let pattern = format!("%{}%", query.trim());
        let mut stmt = self.conn.prepare(
            "SELECT solarSystemID, solarSystemName FROM mapSolarSystems
             WHERE solarSystemName LIKE ?1
             ORDER BY LENGTH(solarSystemName), solarSystemName LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Search NPC stations by name `(id, name)`, shortest-name-first. Player
    /// structures aren't in the SDE, so they're not searchable here.
    pub fn search_stations(&self, query: &str, limit: i64) -> Result<Vec<(i64, String)>, SdeError> {
        let pattern = format!("%{}%", query.trim());
        let mut stmt = self.conn.prepare(
            "SELECT stationID, stationName FROM staStations
             WHERE stationName LIKE ?1
             ORDER BY LENGTH(stationName), stationName LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// The `(solar_system_id, region_id)` an NPC station sits in, if known.
    pub fn station_location(&self, station_id: i64) -> Result<Option<(i64, i64)>, SdeError> {
        let mut stmt = self
            .conn
            .prepare("SELECT solarSystemID, regionID FROM staStations WHERE stationID = ?1")?;
        let mut rows = stmt.query(params![station_id])?;
        match rows.next()? {
            Some(r) => Ok(Some((r.get(0)?, r.get(1)?))),
            None => Ok(None),
        }
    }

    /// The region a solar system belongs to, if known.
    pub fn system_region(&self, system_id: i64) -> Result<Option<i64>, SdeError> {
        let mut stmt = self
            .conn
            .prepare("SELECT regionID FROM mapSolarSystems WHERE solarSystemID = ?1")?;
        let mut rows = stmt.query(params![system_id])?;
        match rows.next()? {
            Some(r) => Ok(Some(r.get(0)?)),
            None => Ok(None),
        }
    }

    /// A single solar system's name, security and region (id + name), via one
    /// join — the point-lookup counterpart to
    /// [`solar_system_info`](Self::solar_system_info), for call sites that
    /// only need one system and shouldn't pay for a full-map load.
    pub fn system_info(&self, system_id: i64) -> Result<Option<SystemInfo>, SdeError> {
        let mut stmt = self.conn.prepare(
            "SELECT s.solarSystemName, s.security, s.regionID, r.regionName
             FROM mapSolarSystems s
             LEFT JOIN mapRegions r ON r.regionID = s.regionID
             WHERE s.solarSystemID = ?1",
        )?;
        let mut rows = stmt.query(params![system_id])?;
        match rows.next()? {
            Some(r) => Ok(Some(SystemInfo {
                name: r.get(0)?,
                // mapSolarSystems.security is populated for every real solar
                // system in the SDE; a NULL here would be a schema anomaly,
                // not a legitimate "unknown" system. Defaulting to 0.0 fails
                // safe for the one caller that branches on sec ranges
                // (market's high-sec-only routing threshold, 0.45): an
                // anomalous row is conservatively excluded from high-sec,
                // never wrongly admitted (#811).
                security: r.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                // regionID/regionName come from the LEFT JOIN and are
                // genuinely absent for a system whose region isn't resolved;
                // 0/"" is just an "unknown region" placeholder label.
                region_id: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                region_name: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            })),
            None => Ok(None),
        }
    }

    /// Stargate edges `(from, to)` whose source is one of `ids` — for building a
    /// system neighbourhood by BFS. K-space only (wormhole systems have no
    /// stargates). One query; the caller walks levels.
    pub fn stargate_edges_from(&self, ids: &[i64]) -> Result<Vec<(i64, i64)>, SdeError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = vec!["?"; ids.len()].join(", ");
        let sql = format!(
            "SELECT fromSolarSystemID, toSolarSystemID FROM mapSolarSystemJumps
             WHERE fromSolarSystemID IN ({placeholders})",
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// NPC station names for the given station ids (from `staStations`). Player
    /// structures (citadels) aren't in the SDE, so they're simply absent and the
    /// caller falls back to a generic label.
    pub fn station_names(&self, ids: &[i64]) -> Result<HashMap<i64, String>, SdeError> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders = vec!["?"; ids.len()].join(", ");
        let sql = format!(
            "SELECT stationID, stationName FROM staStations WHERE stationID IN ({placeholders})",
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut map = HashMap::new();
        for row in rows {
            let (id, name) = row?;
            map.insert(id, name);
        }
        Ok(map)
    }

    /// NPC station info (name + solar system id) for the given station ids.
    /// Player structures (citadels) aren't in the SDE and are absent from the result.
    pub fn station_infos(&self, ids: &[i64]) -> Result<HashMap<i64, (String, i64)>, SdeError> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders = vec!["?"; ids.len()].join(", ");
        let sql = format!(
            "SELECT stationID, stationName, solarSystemID FROM staStations WHERE stationID IN ({placeholders})",
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?;
        let mut map = HashMap::new();
        for row in rows {
            let (id, name, sys_id) = row?;
            map.insert(id, (name, sys_id));
        }
        Ok(map)
    }

    /// Every stargate edge `(from, to)` in known space — the full adjacency for
    /// in-memory route BFS (~13k rows). Cross-chain routing unions wormhole
    /// connections onto this.
    pub fn all_stargate_edges(&self) -> Result<Vec<(i64, i64)>, SdeError> {
        let mut stmt = self
            .conn
            .prepare("SELECT fromSolarSystemID, toSolarSystemID FROM mapSolarSystemJumps")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Undirected stargate adjacency, keyed by solar system id — the
    /// in-memory graph [`sde::graph`](crate::sde::graph) BFS utilities walk.
    /// Built from [`all_stargate_edges`](Self::all_stargate_edges), which
    /// reads `mapSolarSystemJumps`; that table already stores **both**
    /// directions of every gate connection (a `(from, to)` row and its
    /// `(to, from)` mirror), so each edge is added to the map twice over —
    /// once per direction's own `(a, b)` pair. That's harmless for BFS
    /// correctness (a duplicate neighbour is just visited and skipped a
    /// second time), so this does **not** deduplicate; doing so would only
    /// add work for no behavioural change.
    pub fn stargate_adjacency(&self) -> Result<HashMap<i64, Vec<i64>>, SdeError> {
        Ok(crate::sde::graph::undirected_adjacency(
            &self.all_stargate_edges()?,
        ))
    }

    /// Map of solar system id -> (name, security, region name). For the route /
    /// system-activity view. `security` is the raw SDE float (−1.0 … 1.0).
    pub fn solar_system_info(&self) -> Result<HashMap<i64, (String, f64, String)>, SdeError> {
        let mut stmt = self.conn.prepare(
            "SELECT s.solarSystemID, s.solarSystemName, s.security, r.regionName
             FROM mapSolarSystems s
             LEFT JOIN mapRegions r ON r.regionID = s.regionID",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                (
                    row.get::<_, String>(1)?,
                    // Same defensive default as system_info above: real rows
                    // always have a security value, and the caller that
                    // branches on sec ranges treats 0.0 as not-high-sec, the
                    // safe direction (#811).
                    row.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                    // From the LEFT JOIN; "" is just an unresolved-region label.
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                ),
            ))
        })?;
        let mut map = HashMap::new();
        for row in rows {
            let (id, info) = row?;
            map.insert(id, info);
        }
        Ok(map)
    }

    /// Galactic map-plane coordinates `(x, z)` for every solar system. EVE's
    /// star map is the x/z plane (y is height above it), so these plot a
    /// top-down map. Used to seed the faction-warfare map layout.
    pub fn solar_system_positions(&self) -> Result<HashMap<i64, (f64, f64)>, SdeError> {
        let mut stmt = self
            .conn
            .prepare("SELECT solarSystemID, x, z FROM mapSolarSystems")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                (
                    // Every real solar system has map-plane coordinates; a
                    // NULL here is a schema anomaly, not a legitimate origin
                    // point. Used only to seed a visual layout, so a stray
                    // anomalous system landing at (0,0) has no ranking/cost
                    // impact — unlike the invention-probability case (#811).
                    r.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                    r.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                ),
            ))
        })?;
        rows.collect::<Result<HashMap<_, _>, _>>()
            .map_err(Into::into)
    }

    /// Full 3D galactic coordinates `(regionID, x, y, z)` in metres per solar
    /// system — for true light-year distances (e.g. filament range). `y` is the
    /// height off the map plane, which matters for distance.
    pub fn solar_system_geo(&self) -> Result<HashMap<i64, SystemGeo>, SdeError> {
        let mut stmt = self
            .conn
            .prepare("SELECT solarSystemID, regionID, x, y, z FROM mapSolarSystems")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                (
                    r.get::<_, i64>(1)?,
                    // Same reasoning as solar_system_positions: real systems
                    // always carry 3D coordinates; this only feeds distance
                    // filters, not profit/ranking math (#811).
                    r.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                    r.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                    r.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                ),
            ))
        })?;
        rows.collect::<Result<HashMap<_, _>, _>>()
            .map_err(Into::into)
    }

    /// Map of solar system id -> name (for mining ledger / fleet).
    pub fn system_names(&self) -> Result<HashMap<i64, String>, SdeError> {
        let mut stmt = self
            .conn
            .prepare("SELECT solarSystemID, solarSystemName FROM mapSolarSystems")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        rows.collect::<Result<HashMap<_, _>, _>>()
            .map_err(Into::into)
    }

    /// A solar system's planets `(itemID, itemName, planetType)`, ordered by
    /// id (which tracks orbit order — "System I" through "System VIII").
    /// `groupID = 7` is `invGroups`' "Planet" category; `mapDenormalize`
    /// holds every celestial, not just planets, so this filters to just
    /// that group. `planetType` is the bracketed part of the planet's own
    /// `invTypes.typeName` (e.g. "Planet (Barren)" -> "Barren") — the same
    /// vocabulary `ChainNode.planetTypes` uses, so the Planner's planet
    /// picker can show e.g. "Jita IV (Gas)" right next to the chain's own
    /// planet-type badges. For the PI Planner's "where are you building
    /// this" picker (#965, #966).
    pub fn planets_in_system(
        &self,
        system_id: i64,
    ) -> Result<Vec<(i64, String, String)>, SdeError> {
        let mut stmt = self.conn.prepare(
            "SELECT d.itemID, d.itemName, t.typeName
             FROM mapDenormalize d
             JOIN invTypes t ON t.typeID = d.typeID
             WHERE d.solarSystemID = ?1 AND d.groupID = 7
             ORDER BY d.itemID",
        )?;
        let rows = stmt.query_map(params![system_id], |r| {
            let item_id: i64 = r.get(0)?;
            let item_name: String = r.get(1)?;
            let planet_type_name: String = r.get(2)?;
            Ok((item_id, item_name, planet_type_label(&planet_type_name)))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

/// Extract the bracketed planet type from an `invTypes.typeName` like
/// `"Planet (Barren)"` -> `"Barren"`. Falls back to the raw name if it
/// doesn't match that pattern — defensive, not a claim the SDE ever departs
/// from it today.
fn planet_type_label(type_name: &str) -> String {
    type_name
        .split_once('(')
        .and_then(|(_, rest)| rest.strip_suffix(')'))
        .map(str::to_string)
        .unwrap_or_else(|| type_name.to_string())
}

#[cfg(test)]
mod tests {
    use super::super::test_sde;
    use super::planet_type_label;

    #[test]
    fn planets_in_system_filters_to_group_seven_ordered_by_id_with_planet_type() {
        let sde = test_sde(
            "CREATE TABLE mapDenormalize(itemID INT, itemName TEXT, solarSystemID INT, groupID INT, typeID INT);
             CREATE TABLE invTypes(typeID INT, typeName TEXT);
             INSERT INTO invTypes VALUES
               (2016, 'Planet (Barren)'),
               (13, 'Planet (Gas)'),
               (2015, 'Planet (Lava)');
             INSERT INTO mapDenormalize VALUES
               (40009082, 'Jita 4', 30000142, 7, 13),
               (40009077, 'Jita 1', 30000142, 7, 2016),
               (40009078, 'Jita 2', 30000142, 7, 2016),
               (99999999, 'Jita 4 - Moon 1', 30000142, 8, 2016),
               (11111111, 'Amarr 1', 30002187, 7, 2015);",
        );
        let planets = sde.planets_in_system(30000142).unwrap();
        assert_eq!(
            planets,
            vec![
                (40009077, "Jita 1".to_string(), "Barren".to_string()),
                (40009078, "Jita 2".to_string(), "Barren".to_string()),
                (40009082, "Jita 4".to_string(), "Gas".to_string()),
            ]
        );
    }

    #[test]
    fn planets_in_system_is_empty_for_an_unknown_system() {
        let sde = test_sde(
            "CREATE TABLE mapDenormalize(itemID INT, itemName TEXT, solarSystemID INT, groupID INT, typeID INT);
             CREATE TABLE invTypes(typeID INT, typeName TEXT);",
        );
        assert!(sde.planets_in_system(30000142).unwrap().is_empty());
    }

    #[test]
    fn planet_type_label_extracts_the_bracketed_part() {
        assert_eq!(planet_type_label("Planet (Barren)"), "Barren");
        assert_eq!(
            planet_type_label("Planet (Scorched Barren)"),
            "Scorched Barren"
        );
    }

    #[test]
    fn planet_type_label_falls_back_to_the_raw_name_without_brackets() {
        assert_eq!(planet_type_label("Something Else"), "Something Else");
    }
}
