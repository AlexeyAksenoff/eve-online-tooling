//! Checks the latest published GitHub Release against the running build's own
//! version, so the Settings page can tell the user "an update is available"
//! instead of them finding out by chance.
//!
//! Opt-out, not opt-in (default ON, toggled in Settings): the one call this
//! makes is a single `GET` to GitHub's public, unauthenticated Releases API —
//! no account, no payload about the user, nothing but "what's the latest tag".
//! Routed through the same provider-agnostic [`crate::net::conditional_cache`]
//! every other third-party integration uses (EVE-Scout, zKillboard): GitHub's
//! Releases API sends a real `ETag`, so a repeat check inside the TTL costs a
//! cheap 304, not a full re-fetch.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::net::conditional_cache::ConditionalCache;

/// GitHub's "most recent non-prerelease, non-draft release" endpoint — exactly
/// what `v*` tags in `.github/workflows/release.yml` publish.
const RELEASES_URL: &str =
    "https://api.github.com/repos/th-lange/eve-online-tooling/releases/latest";
/// Cache key for the raw response.
const CACHE_KEY: &str = "release_check_latest";

/// The subset of GitHub's release JSON this cares about. Unknown fields are
/// ignored (serde default), so the response can grow without breaking us.
#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    published_at: String,
}

/// What the frontend needs to render a status line and, if outdated, a link.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseStatus {
    /// This build's version (`CARGO_PKG_VERSION`, e.g. `"0.71.0"`).
    pub current_version: String,
    /// The latest published release's tag, with any leading `v` stripped.
    pub latest_version: String,
    /// True when `latest_version` is a newer semver than `current_version`.
    pub is_outdated: bool,
    /// The release's GitHub page, for the "what's new" link.
    pub html_url: String,
    /// RFC-3339 publish timestamp, as GitHub reports it.
    pub published_at: String,
}

/// Semver-compares a release tag (`"v0.72.0"` or `"0.72.0"`) against the
/// running build's version. A tag that doesn't parse as semver is treated as
/// "not outdated" — a malformed/unexpected tag should never nag the user,
/// just silently decline to flag an update. Pure, so it's unit-testable
/// without any network access.
fn is_outdated(current: &str, latest_tag: &str) -> bool {
    let Ok(current) = semver::Version::parse(current) else {
        return false;
    };
    let Ok(latest) = semver::Version::parse(latest_tag.trim_start_matches('v')) else {
        return false;
    };
    latest > current
}

/// The live fetch behind a cache miss, routed through the shared conditional
/// cache exactly like [`crate::evescout::fetch_live`].
async fn fetch_latest_release(dir: &std::path::Path) -> Result<GithubRelease, String> {
    let http = crate::esi::http_client_builder()
        .build()
        .map_err(|e| e.to_string())?;
    let cache = ConditionalCache::on_disk(dir.to_path_buf());
    cache
        .get_json(
            CACHE_KEY,
            || {
                http.get(RELEASES_URL)
                    .header("Accept", "application/vnd.github+json")
            },
            |rb| async move { rb.send().await },
        )
        .await
        .map_err(|e| e.to_string())
}

/// Compare the running build against the latest GitHub Release. Network/parse
/// failures surface as `Err` — the Settings page shows them inline rather
/// than silently pretending everything is current.
#[tauri::command]
pub async fn release_check_latest(app: AppHandle) -> Result<ReleaseStatus, String> {
    let dir = crate::storage::app_data_dir(&app)?;
    let current_version = app.package_info().version.to_string();
    let release = fetch_latest_release(&dir).await?;
    let latest_version = release.tag_name.trim_start_matches('v').to_string();
    Ok(ReleaseStatus {
        is_outdated: is_outdated(&current_version, &release.tag_name),
        current_version,
        latest_version,
        html_url: release.html_url,
        published_at: release.published_at,
    })
}

#[cfg(test)]
mod tests {
    use super::is_outdated;

    #[test]
    fn flags_a_newer_release() {
        assert!(is_outdated("0.71.0", "v0.72.0"));
        assert!(is_outdated("0.71.0", "0.72.0"));
        assert!(is_outdated("0.71.0", "v1.0.0"));
    }

    #[test]
    fn does_not_flag_equal_or_older_releases() {
        assert!(!is_outdated("0.71.0", "v0.71.0"));
        assert!(!is_outdated("0.71.0", "v0.70.0"));
        assert!(!is_outdated("1.0.0", "v0.99.0"));
    }

    #[test]
    fn treats_an_unparseable_tag_as_not_outdated() {
        // A hotfix branch tag, a typo, a non-release tag someone pushed —
        // never nag over something that isn't a real semver release.
        assert!(!is_outdated("0.71.0", "nightly"));
        assert!(!is_outdated("0.71.0", "v0.72"));
    }
}
