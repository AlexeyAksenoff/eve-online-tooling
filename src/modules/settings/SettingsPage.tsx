import { Page, PageHeader } from "../../components/page";
import { useFightOverlay } from "../pvp/fightOverlayContext";
import { useFwHomeDefense } from "../faction-warfare/fwHomeDefenseContext";
import type { NearbyFlipRadius } from "../faction-warfare/homeDefenseAlerts";

const NEARBY_FLIP_OPTIONS: readonly { key: NearbyFlipRadius; label: string }[] =
  [
    { key: "3", label: "3j" },
    { key: "5", label: "5j" },
    { key: "10", label: "10j" },
    { key: "off", label: "Off" },
  ];

/**
 * App-wide preferences that don't belong to any one feature module. The
 * underlying state for each setting still lives where its behavior is
 * implemented (e.g. the fight overlay's `enabled` flag lives in
 * `FightOverlayProvider`, mounted at the app root) — this page is just a
 * discoverable, central place to flip them, alongside the PVP page's own
 * "Show fight overlay" checkbox.
 */
export function SettingsPage() {
  const {
    enabled: combatOverviewOn,
    setEnabled: setCombatOverviewOn,
    runTest,
  } = useFightOverlay();
  const {
    vulnerableAlertOn,
    setVulnerableAlertOn,
    nearbyFlipRadius,
    setNearbyFlipRadius,
  } = useFwHomeDefense();

  return (
    <Page>
      <PageHeader
        title="Settings"
        subtitle="App-wide preferences that apply across every module."
      />
      <div className="mt-6 divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/40">
        <div className="flex items-start justify-between gap-4 p-4">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-zinc-100">
              Display Combat Overview
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Pop over live combat details — attackers, DPS, and their fits —
              the moment your gamelog shows you in a fight. Shown over every
              module, not just PVP.
            </span>
          </span>
          <div className="mt-1 flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={runTest}
              className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              title="Preview the overlay with random sample data"
            >
              Test
            </button>
            <input
              type="checkbox"
              checked={combatOverviewOn}
              onChange={(e) => setCombatOverviewOn(e.currentTarget.checked)}
              className="h-4 w-4 shrink-0 cursor-pointer accent-indigo-500"
              aria-label="Display Combat Overview"
            />
          </div>
        </div>
        <div className="flex items-start justify-between gap-4 p-4">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-zinc-100">
              FW: home system vulnerable
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Notify when a system your militia holds enters the vulnerable
              state. Shown over every module, not just Faction Warfare.
            </span>
          </span>
          <input
            type="checkbox"
            checked={vulnerableAlertOn}
            onChange={(e) => setVulnerableAlertOn(e.currentTarget.checked)}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-indigo-500"
            aria-label="FW: home system vulnerable"
          />
        </div>
        <div className="flex items-start justify-between gap-4 p-4">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-zinc-100">
              FW: nearby system flipped
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Notify when any system within this many jumps of your current
              location changes contested state. "Off" disables this alert.
            </span>
          </span>
          <div className="mt-1 flex shrink-0 overflow-hidden rounded border border-zinc-700 text-sm">
            {NEARBY_FLIP_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setNearbyFlipRadius(o.key)}
                className={`px-3 py-1 ${
                  nearbyFlipRadius === o.key
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Page>
  );
}
