//! Per-colony notes + target-product list: local, user-authored data attached
//! to an ESI-derived colony, keyed by `(character_id, planet_id)` — colonies
//! have no locally-assigned id and aren't created/deleted by this app, they're
//! whatever ESI's `/characters/{id}/planets/` currently lists. So there's no
//! explicit "delete colony" action to cascade from; instead [`load_pruned`]
//! drops any stored row whose colony no longer appears for a character whose
//! planets list *was* successfully fetched this round — called once per
//! `pi_overview` fetch, right before merging notes into the response.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::sde::Sde;
use crate::storage;

const STORE_KEY: &str = "pi_colony_notes";
/// Keep target lists bounded — this is a quick "what am I building here"
/// reminder, not a full bill of materials.
const MAX_TARGET_PRODUCTS: usize = 20;
/// Free-text notes cap, generous for a few sentences / a short bullet list.
const MAX_NOTES_LEN: usize = 4000;

/// One colony's stored notes/targets. Absent for any colony the user hasn't
/// annotated — rows are only created on the first non-empty save ([`set`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ColonyNote {
    pub(crate) character_id: i64,
    pub(crate) planet_id: i64,
    #[serde(default)]
    pub(crate) notes: String,
    #[serde(default)]
    pub(crate) target_product_type_ids: Vec<i64>,
}

/// A target product resolved to its display name, for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetProductView {
    pub type_id: i64,
    pub name: String,
}

/// A colony's notes/targets, resolved for the frontend — returned by
/// [`crate::modules::pi::commands::pi_colony_note_set`] so the caller can
/// merge it straight into its cached `pi_overview` result without an ESI
/// round-trip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColonyNoteView {
    pub character_id: i64,
    pub planet_id: i64,
    pub notes: String,
    pub target_products: Vec<TargetProductView>,
}

/// Which `(character_id, planet_id)` pairs are confirmed live this round, and
/// which characters' planet lists were successfully fetched — from the raw
/// per-character `(character_id, planet_ids)` fetch results. Pure, so the
/// liveness/pruning rule is testable without touching ESI. A character absent
/// from `fetched` (its list call failed) contributes nothing to `live`, and
/// [`load_pruned`] leaves that character's stored rows untouched rather than
/// risk deleting notes for a colony that's still there but just unreachable
/// right now.
pub(crate) fn colony_liveness(fetched: &[(i64, Vec<i64>)]) -> (HashSet<(i64, i64)>, HashSet<i64>) {
    let mut live = HashSet::new();
    let mut fetched_characters = HashSet::new();
    for (character_id, planet_ids) in fetched {
        fetched_characters.insert(*character_id);
        for &planet_id in planet_ids {
            live.insert((*character_id, planet_id));
        }
    }
    (live, fetched_characters)
}

/// Load the stored notes, pruned of any colony that's gone for a character
/// whose planets list fetched successfully this round. Saves back only when
/// pruning actually dropped something.
pub(crate) fn load_pruned(
    dir: &std::path::Path,
    live: &HashSet<(i64, i64)>,
    fetched_characters: &HashSet<i64>,
) -> Vec<ColonyNote> {
    let raw: Vec<ColonyNote> = storage::load_data(dir, STORE_KEY).unwrap_or_default();
    let before = raw.len();
    let kept: Vec<ColonyNote> = raw
        .into_iter()
        .filter(|n| {
            !fetched_characters.contains(&n.character_id)
                || live.contains(&(n.character_id, n.planet_id))
        })
        .collect();
    if kept.len() != before {
        let _ = storage::save_data(dir, STORE_KEY, &kept);
    }
    kept
}

/// Upsert one colony's notes/target list. Blank notes with no targets removes
/// the row entirely — nothing worth persisting for an empty entry.
pub(crate) fn set(
    dir: &std::path::Path,
    character_id: i64,
    planet_id: i64,
    notes: String,
    mut target_product_type_ids: Vec<i64>,
) -> Result<ColonyNote, String> {
    let notes: String = notes.chars().take(MAX_NOTES_LEN).collect();
    target_product_type_ids.truncate(MAX_TARGET_PRODUCTS);

    let mut all: Vec<ColonyNote> = storage::load_data(dir, STORE_KEY).unwrap_or_default();
    all.retain(|n| !(n.character_id == character_id && n.planet_id == planet_id));

    let row = ColonyNote {
        character_id,
        planet_id,
        notes,
        target_product_type_ids,
    };
    if !row.notes.is_empty() || !row.target_product_type_ids.is_empty() {
        all.push(row.clone());
    }
    storage::save_data(dir, STORE_KEY, &all)?;
    Ok(row)
}

/// Resolve a note's target type ids to display names via the SDE. Unknown ids
/// (e.g. a renamed/removed type) fall back to `#<id>` rather than dropping
/// the entry.
pub(crate) fn target_views(sde: &Sde, note: &ColonyNote) -> Vec<TargetProductView> {
    let names: std::collections::HashMap<i64, String> = sde
        .type_names(&note.target_product_type_ids)
        .unwrap_or_default()
        .into_iter()
        .collect();
    note.target_product_type_ids
        .iter()
        .map(|&id| TargetProductView {
            type_id: id,
            name: names.get(&id).cloned().unwrap_or_else(|| format!("#{id}")),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("eve-pi-notes-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn colony_liveness_unions_pairs_per_fetched_character() {
        let (live, fetched) = colony_liveness(&[(1, vec![100, 101]), (2, vec![200])]);
        assert!(live.contains(&(1, 100)));
        assert!(live.contains(&(1, 101)));
        assert!(live.contains(&(2, 200)));
        assert!(!live.contains(&(2, 100)));
        assert_eq!(fetched, HashSet::from([1, 2]));
    }

    #[test]
    fn colony_liveness_omits_characters_whose_fetch_never_ran() {
        let (live, fetched) = colony_liveness(&[(1, vec![100])]);
        assert!(!fetched.contains(&2));
        assert!(!live.is_empty()); // sanity: character 1's pair is present
    }

    #[test]
    fn set_then_load_round_trips() {
        let dir = test_dir("roundtrip");
        set(&dir, 1, 100, "build robotics here".into(), vec![9848]).unwrap();
        let (live, fetched) = colony_liveness(&[(1, vec![100])]);
        let rows = load_pruned(&dir, &live, &fetched);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].notes, "build robotics here");
        assert_eq!(rows[0].target_product_type_ids, vec![9848]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_notes_and_targets_removes_the_row() {
        let dir = test_dir("empty-removes");
        set(&dir, 1, 100, "something".into(), vec![9848]).unwrap();
        set(&dir, 1, 100, String::new(), vec![]).unwrap();
        let (live, fetched) = colony_liveness(&[(1, vec![100])]);
        assert!(load_pruned(&dir, &live, &fetched).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_drops_a_row_whose_colony_is_gone_for_a_successfully_fetched_character() {
        let dir = test_dir("prune-gone");
        set(&dir, 1, 100, "old colony".into(), vec![]).unwrap();
        // Character 1's list was fetched this round, but planet 100 isn't in
        // it any more (abandoned in-game) — the row should be dropped.
        let (live, fetched) = colony_liveness(&[(1, vec![101])]);
        assert!(load_pruned(&dir, &live, &fetched).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_leaves_a_row_untouched_when_its_character_fetch_failed_this_round() {
        let dir = test_dir("prune-skip");
        set(&dir, 1, 100, "still here".into(), vec![]).unwrap();
        // Character 1 isn't in `fetched` at all this round (its ESI call
        // failed) — we can't tell whether the colony is gone, so keep it.
        let (live, fetched) = colony_liveness(&[(2, vec![200])]);
        let rows = load_pruned(&dir, &live, &fetched);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].notes, "still here");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn notes_and_target_list_are_capped() {
        let dir = test_dir("caps");
        let long_notes = "x".repeat(MAX_NOTES_LEN + 500);
        let many_targets: Vec<i64> = (0..(MAX_TARGET_PRODUCTS as i64 + 10)).collect();
        let row = set(&dir, 1, 100, long_notes, many_targets).unwrap();
        assert_eq!(row.notes.chars().count(), MAX_NOTES_LEN);
        assert_eq!(row.target_product_type_ids.len(), MAX_TARGET_PRODUCTS);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
