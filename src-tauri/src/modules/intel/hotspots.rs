//! FW kill hotspots (#905): "where is my militia fighting right now, where
//! is the enemy, and where is the NPC cartel active" — bucketed per system
//! from zKillboard's faction-scoped feeds. ESI's own `/universe/system_
//! kills/` counter (used by [`super::commands::intel_fw_systems`]) mixes in
//! every neutral gank and can't answer "whose kills", so this reuses the
//! shared zKill utility module ([`crate::zkill`]) instead — its disk
//! caching, concurrency cap and rate-limit discipline apply unchanged.
//!
//! Known limitation, surfaced in the UI rather than hidden: insurgency
//! corruption/suppression stage has no public ESI endpoint, so only the
//! cartel's *kill activity* can be shown here, not the corruption bar.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::esi::AuthState;
use crate::storage;
use crate::zkill::{self, ZkillLossRef};

use super::commands::warzone;

/// Only count kills from roughly the last 6h — recent enough to reflect
/// "right now" rather than the whole campaign.
const HOTSPOT_WINDOW_SECS: i64 = 6 * 60 * 60;
/// Aggregate result cache: zKill data moves fast, but recomputing on every
/// FW page focus would hammer both zKill and ESI for no benefit — 5 minutes
/// matches the acceptance criterion's minimum TTL.
const HOTSPOT_TTL_SECS: u64 = 5 * 60;
/// Killmails are immutable once created — cache their resolution forever
/// (mirrors localintel's per-killmail cache, different key prefix so the two
/// don't collide on TTL/shape expectations).
const KILLMAIL_TTL_SECS: u64 = 60 * 60 * 24 * 3650;

/// The warzone's NPC pirate faction for the militia at `faction_id`. Both
/// pairs of a warzone share one cartel: Guristas Pirates harass the
/// Caldari–Gallente warzone, Angel Cartel the Amarr–Minmatar one.
pub fn cartel_faction_id(faction_id: i64) -> i64 {
    if warzone(faction_id) == "Caldari–Gallente" {
        500_010 // Guristas Pirates
    } else {
        500_011 // Angel Cartel
    }
}

/// Just enough of a resolved killmail to place it in time and space — the
/// bucket (friendly/enemy/cartel) is already known from which zKill feed it
/// came from, so no victim/attacker faction fields are needed here.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct HotspotKillmail {
    #[serde(default)]
    killmail_time: String,
    #[serde(default)]
    solar_system_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HotspotSystemCounts {
    pub system_id: i64,
    pub friendly_losses: i64,
    pub enemy_losses: i64,
    pub cartel_activity: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotspotsResult {
    pub systems: Vec<HotspotSystemCounts>,
    /// When the REST baseline was computed (unix epoch seconds) — the live
    /// top-up (#925) only merges events observed strictly after this, so a
    /// cached snapshot re-merged on every call never double-counts.
    pub fetched_at: u64,
}

fn cache_key(my_faction: i64, enemy_faction: i64) -> String {
    format!("fw_hotspots_{my_faction}_{enemy_faction}")
}

/// De-dupe a merged kills+losses feed (a mail could in principle surface in
/// both, e.g. a cartel NPC killing then being avenged in the same brawl).
fn dedup_refs(refs: &mut Vec<ZkillLossRef>) {
    let mut seen = HashSet::new();
    refs.retain(|r| seen.insert(r.killmail_id));
}

/// Resolve each zKill ref to a solar system id, dropping mails older than
/// [`HOTSPOT_WINDOW_SECS`] or that fail to resolve. Fans out across
/// [`zkill::ZKILL_CONCURRENCY`], same as every other zKill-backed command.
async fn resolve_systems_within_window(
    dir: &Path,
    http: &reqwest::Client,
    refs: Vec<ZkillLossRef>,
) -> Vec<i64> {
    let cutoff = crate::util::time::now_secs() as i64 - HOTSPOT_WINDOW_SECS;
    let dir = dir.to_path_buf();
    stream::iter(refs)
        .map(|r| {
            let dir = dir.clone();
            async move {
                let key = format!("fw_hotspot_km_{}", r.killmail_id);
                let km: Option<HotspotKillmail> =
                    if let Some(cached) = storage::cache_get(&dir, &key) {
                        Some(cached)
                    } else {
                        let fetched: Option<HotspotKillmail> =
                            crate::esi::fetch_killmail(http, r.killmail_id, &r.zkb.hash).await;
                        if let Some(k) = &fetched {
                            let _ = storage::cache_put(&dir, &key, k, KILLMAIL_TTL_SECS);
                        }
                        fetched
                    };
                km.and_then(|k| {
                    let t = crate::util::time::parse_rfc3339_epoch(&k.killmail_time).ok()? as i64;
                    (t >= cutoff && k.solar_system_id > 0).then_some(k.solar_system_id)
                })
            }
        })
        .buffered(zkill::ZKILL_CONCURRENCY)
        .filter_map(|x| async move { x })
        .collect()
        .await
}

/// Pure: merge three per-system id lists (one entry per kill, so a system
/// with 3 friendly losses has its id 3 times in `friendly_losses`) into
/// bucketed counts. Only systems with at least one count of any kind appear.
pub fn bucket_hotspots(
    friendly_losses: &[i64],
    enemy_losses: &[i64],
    cartel_activity: &[i64],
) -> Vec<HotspotSystemCounts> {
    let mut map: HashMap<i64, HotspotSystemCounts> = HashMap::new();
    let mut bump = |id: i64, f: fn(&mut HotspotSystemCounts)| {
        f(map.entry(id).or_insert(HotspotSystemCounts {
            system_id: id,
            friendly_losses: 0,
            enemy_losses: 0,
            cartel_activity: 0,
        }));
    };
    for &id in friendly_losses {
        bump(id, |c| c.friendly_losses += 1);
    }
    for &id in enemy_losses {
        bump(id, |c| c.enemy_losses += 1);
    }
    for &id in cartel_activity {
        bump(id, |c| c.cartel_activity += 1);
    }
    let mut out: Vec<_> = map.into_values().collect();
    out.sort_by_key(|c| c.system_id);
    out
}

/// Pure: add live-observed per-system counts on top of a REST baseline
/// (#925) — the REST snapshot stays cached for [`HOTSPOT_TTL_SECS`]
/// unmodified; this runs fresh on every call so a stale cache entry still
/// reflects anything the live stream has seen since it was fetched, without
/// ever re-caching the merged result (which would double-count on the next
/// call once the same live events get merged again).
pub fn merge_live_topup(
    baseline: Vec<HotspotSystemCounts>,
    friendly_live: &HashMap<i64, i64>,
    enemy_live: &HashMap<i64, i64>,
    cartel_live: &HashMap<i64, i64>,
) -> Vec<HotspotSystemCounts> {
    let mut map: HashMap<i64, HotspotSystemCounts> =
        baseline.into_iter().map(|c| (c.system_id, c)).collect();
    let mut bump = |id: i64, n: i64, f: fn(&mut HotspotSystemCounts, i64)| {
        f(
            map.entry(id).or_insert(HotspotSystemCounts {
                system_id: id,
                friendly_losses: 0,
                enemy_losses: 0,
                cartel_activity: 0,
            }),
            n,
        );
    };
    for (&id, &n) in friendly_live {
        bump(id, n, |c, n| c.friendly_losses += n);
    }
    for (&id, &n) in enemy_live {
        bump(id, n, |c, n| c.enemy_losses += n);
    }
    for (&id, &n) in cartel_live {
        bump(id, n, |c, n| c.cartel_activity += n);
    }
    let mut out: Vec<_> = map.into_values().collect();
    out.sort_by_key(|c| c.system_id);
    out
}

/// FW kill hotspots for the selected militia (#905): friendly losses, enemy
/// losses, and NPC cartel activity, bucketed per system over the last ~6h.
/// The REST baseline is cached [`HOTSPOT_TTL_SECS`]; on top of that, every
/// call merges in anything the shared live kill-stream (#924) has observed
/// since the baseline was fetched (#925) — no per-kill ESI resolution
/// needed for those, since the live stream already carries `solar_system_
/// id`/`faction_id` on every event.
#[tauri::command]
pub async fn intel_fw_hotspots(
    app: AppHandle,
    auth_state: State<'_, AuthState>,
    my_faction: i64,
    enemy_faction: i64,
) -> Result<HotspotsResult, String> {
    let dir = storage::app_data_dir(&app)?;
    let key = cache_key(my_faction, enemy_faction);
    let mut result = match storage::cache_get::<HotspotsResult>(&dir, &key) {
        Some(cached) => cached,
        None => {
            let http = auth_state.http().clone();
            let cartel = cartel_faction_id(my_faction);

            let friendly_refs = zkill::losses_for_faction(my_faction).await;
            let enemy_refs = zkill::losses_for_faction(enemy_faction).await;
            let mut cartel_refs = zkill::kills_for_faction(cartel).await;
            cartel_refs.extend(zkill::losses_for_faction(cartel).await);
            dedup_refs(&mut cartel_refs);

            let friendly_ids = resolve_systems_within_window(&dir, &http, friendly_refs).await;
            let enemy_ids = resolve_systems_within_window(&dir, &http, enemy_refs).await;
            let cartel_ids = resolve_systems_within_window(&dir, &http, cartel_refs).await;

            let fresh = HotspotsResult {
                systems: bucket_hotspots(&friendly_ids, &enemy_ids, &cartel_ids),
                fetched_at: crate::util::time::now_secs(),
            };
            let _ = storage::cache_put(&dir, &key, &fresh, HOTSPOT_TTL_SECS);
            fresh
        }
    };

    // Live top-up (#925): merge anything observed since `fetched_at`. Never
    // re-cached — `result.fetched_at` stays the original baseline time, so
    // the next call re-merges fresh instead of double-counting.
    if let Some(state) = app.try_state::<zkill::live::ZkillStreamState>() {
        let cartel = cartel_faction_id(my_faction);
        let idx = state.index.lock();
        let since = result.fetched_at;
        let friendly_live = idx.counts_by_system_where(|e| {
            e.time_secs > since && e.victim_faction_id == Some(my_faction)
        });
        let enemy_live = idx.counts_by_system_where(|e| {
            e.time_secs > since && e.victim_faction_id == Some(enemy_faction)
        });
        let cartel_live = idx.counts_by_system_where(|e| {
            e.time_secs > since
                && (e.victim_faction_id == Some(cartel) || e.attacker_faction_ids.contains(&cartel))
        });
        result.systems =
            merge_live_topup(result.systems, &friendly_live, &enemy_live, &cartel_live);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cartel_faction_id_maps_each_warzone_to_its_own_pirate_faction() {
        assert_eq!(cartel_faction_id(500001), 500_010); // Caldari State
        assert_eq!(cartel_faction_id(500004), 500_010); // Gallente Federation
        assert_eq!(cartel_faction_id(500003), 500_011); // Amarr Empire
        assert_eq!(cartel_faction_id(500002), 500_011); // Minmatar Republic
    }

    #[test]
    fn buckets_each_list_into_its_own_column() {
        let out = bucket_hotspots(&[1, 1, 2], &[2], &[1]);
        let by_id: HashMap<i64, HotspotSystemCounts> =
            out.into_iter().map(|c| (c.system_id, c)).collect();
        assert_eq!(by_id[&1].friendly_losses, 2);
        assert_eq!(by_id[&1].enemy_losses, 0);
        assert_eq!(by_id[&1].cartel_activity, 1);
        assert_eq!(by_id[&2].friendly_losses, 1);
        assert_eq!(by_id[&2].enemy_losses, 1);
        assert_eq!(by_id[&2].cartel_activity, 0);
    }

    #[test]
    fn omits_systems_with_no_activity_in_any_bucket() {
        let out = bucket_hotspots(&[1], &[], &[]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].system_id, 1);
    }

    #[test]
    fn empty_inputs_produce_an_empty_result() {
        assert!(bucket_hotspots(&[], &[], &[]).is_empty());
    }

    #[test]
    fn results_are_sorted_by_system_id() {
        let out = bucket_hotspots(&[3, 1, 2], &[], &[]);
        let ids: Vec<i64> = out.iter().map(|c| c.system_id).collect();
        assert_eq!(ids, vec![1, 2, 3]);
    }

    #[test]
    fn merge_live_topup_adds_onto_matching_systems_in_the_baseline() {
        let baseline = bucket_hotspots(&[1], &[], &[]);
        let friendly_live = HashMap::from([(1i64, 2i64)]);
        let out = merge_live_topup(baseline, &friendly_live, &HashMap::new(), &HashMap::new());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].friendly_losses, 3); // 1 baseline + 2 live
    }

    #[test]
    fn merge_live_topup_adds_a_new_system_not_in_the_baseline() {
        let baseline = bucket_hotspots(&[1], &[], &[]);
        let cartel_live = HashMap::from([(2i64, 1i64)]);
        let out = merge_live_topup(baseline, &HashMap::new(), &HashMap::new(), &cartel_live);
        let by_id: HashMap<i64, HotspotSystemCounts> =
            out.into_iter().map(|c| (c.system_id, c)).collect();
        assert_eq!(by_id[&1].friendly_losses, 1);
        assert_eq!(by_id[&2].cartel_activity, 1);
    }

    #[test]
    fn merge_live_topup_is_a_no_op_with_no_live_data() {
        let baseline = bucket_hotspots(&[1, 1], &[2], &[]);
        let out = merge_live_topup(
            baseline.clone(),
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
        );
        assert_eq!(out, baseline);
    }
}
