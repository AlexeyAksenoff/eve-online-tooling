//! Persisted "build lists" for Mass Production — a named, reusable set of
//! blueprint type ids plus any per-line build-run overrides (see
//! [`super::commands::BlueprintLine`]), so a frequently-repeated mass build
//! (e.g. a standing doctrine restock) can be saved once and replayed without
//! re-pasting every blueprint name.
//!
//! Mirrors the Shopping Lists module's single-JSON-document-per-feature
//! approach (`crate::storage::load_data`/`save_data`): one
//! `massprod_build_lists` document holding every saved list; display names
//! are resolved from the SDE only when read out, so they stay correct across
//! SDE updates (same approach as `crate::lists`/`shopping`).

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::sde::Sde;
use crate::storage;

/// Storage document name (a JSON file in `<app data>/data/`).
const STORE_KEY: &str = "massprod_build_lists";

// --- Stored shape -----------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Store {
    lists: Vec<StoredList>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredList {
    id: String,
    name: String,
    #[serde(default)]
    items: Vec<StoredLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredLine {
    #[serde(rename = "typeId", alias = "type_id")]
    type_id: i64,
    /// Saved per-line build-run override — `None` replays as "use the
    /// mode's default", exactly like a fresh, un-overridden paste.
    #[serde(default)]
    build_runs: Option<i64>,
}

fn load(dir: &std::path::Path) -> Store {
    storage::load_data(dir, STORE_KEY).unwrap_or_default()
}

fn save(dir: &std::path::Path, store: &Store) -> Result<(), String> {
    storage::save_data(dir, STORE_KEY, store)
}

// --- Resolved shape returned to the frontend --------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildListItem {
    pub type_id: i64,
    pub name: String,
    pub build_runs: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildList {
    pub id: String,
    pub name: String,
    pub items: Vec<BuildListItem>,
}

/// Resolve a stored list's item names from the SDE.
fn resolve(sde: &Sde, list: &StoredList) -> BuildList {
    let ids: Vec<i64> = list.items.iter().map(|e| e.type_id).collect();
    let names = sde.type_name_map(&ids).unwrap_or_default();
    let items = list
        .items
        .iter()
        .map(|e| BuildListItem {
            type_id: e.type_id,
            name: names.get(e.type_id),
            build_runs: e.build_runs,
        })
        .collect();
    BuildList {
        id: list.id.clone(),
        name: list.name.clone(),
        items,
    }
}

// --- Commands ---------------------------------------------------------------

/// Every saved build list (names resolved from the SDE).
#[tauri::command]
pub fn massprod_lists(app: AppHandle) -> Result<Vec<BuildList>, String> {
    let (dir, sde) = crate::sde::dir_and_sde(&app)?;
    let store = load(&dir);
    Ok(store.lists.iter().map(|l| resolve(&sde, l)).collect())
}

/// One line to save: a resolved blueprint type id plus its (optional)
/// build-run override — the frontend already has both from the current
/// plan, so saving needs no SDE re-resolution of names.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveListItem {
    pub type_id: i64,
    #[serde(default)]
    pub build_runs: Option<i64>,
}

/// Save a build list (pasted blueprints + any per-line run overrides) under
/// a name, returning the resolved saved list. The id is a slug of the name,
/// de-duplicated with a numeric suffix (same scheme as
/// `shopping_create_list`). Every saved list is user-removable.
#[tauri::command]
pub fn massprod_save_list(
    app: AppHandle,
    name: String,
    items: Vec<SaveListItem>,
) -> Result<BuildList, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("list name can't be empty".into());
    }
    let (dir, sde) = crate::sde::dir_and_sde(&app)?;
    let mut store = load(&dir);

    let base: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let base = base.trim_matches('-').to_string();
    let base = if base.is_empty() {
        "list".to_string()
    } else {
        base
    };
    let mut id = base.clone();
    let mut n = 2;
    while store.lists.iter().any(|l| l.id == id) {
        id = format!("{base}-{n}");
        n += 1;
    }

    let list = StoredList {
        id,
        name,
        items: items
            .into_iter()
            .map(|i| StoredLine {
                type_id: i.type_id,
                build_runs: i.build_runs,
            })
            .collect(),
    };
    store.lists.push(list.clone());
    save(&dir, &store)?;
    Ok(resolve(&sde, &list))
}

/// Delete a saved build list (no-op if already absent).
#[tauri::command]
pub fn massprod_delete_list(app: AppHandle, id: String) -> Result<(), String> {
    let (dir, _sde) = crate::sde::dir_and_sde(&app)?;
    let mut store = load(&dir);
    store.lists.retain(|l| l.id != id);
    save(&dir, &store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sde::test_sde;

    fn fixture() -> Sde {
        test_sde(
            "CREATE TABLE invTypes(typeID INT, groupID INT, typeName TEXT, volume REAL);
             INSERT INTO invTypes VALUES (1073, 1, '5MN Microwarpdrive II Blueprint', 0.01);",
        )
    }

    #[test]
    fn resolve_fills_in_sde_names_and_carries_build_runs() {
        let sde = fixture();
        let list = StoredList {
            id: "doctrine".into(),
            name: "Doctrine".into(),
            items: vec![
                StoredLine {
                    type_id: 1073,
                    build_runs: Some(5),
                },
                StoredLine {
                    type_id: 999999,
                    build_runs: None,
                },
            ],
        };

        let resolved = resolve(&sde, &list);

        assert_eq!(resolved.items[0].name, "5MN Microwarpdrive II Blueprint");
        assert_eq!(resolved.items[0].build_runs, Some(5));
        // Unknown type id (stale SDE) falls back to `TypeNameMap`'s own
        // "Type <id>" placeholder instead of erroring the whole list out.
        assert_eq!(resolved.items[1].name, "Type 999999");
        assert_eq!(resolved.items[1].build_runs, None);
    }
}
