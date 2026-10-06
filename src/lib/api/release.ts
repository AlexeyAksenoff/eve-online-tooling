import { invoke } from "@tauri-apps/api/core";

/** Current build vs. the latest published GitHub Release. */
export interface ReleaseStatus {
  currentVersion: string;
  latestVersion: string;
  isOutdated: boolean;
  /** The release's GitHub page, for the "what's new" link. */
  htmlUrl: string;
  /** RFC-3339 publish timestamp, as GitHub reports it. */
  publishedAt: string;
}

/**
 * Compare the running build against the latest GitHub Release
 * (`th-lange/eve-online-tooling`). One unauthenticated GET, cached on disk
 * with ETag revalidation — see `release_check` on the Rust side.
 */
export function releaseCheckLatest(): Promise<ReleaseStatus> {
  return invoke<ReleaseStatus>("release_check_latest");
}
