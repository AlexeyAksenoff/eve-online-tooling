import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  authCharacters,
  fwSystems,
  intelFwEnlistment,
  intelFwJumps,
} from "../../lib/api";
import { usePersistentState } from "../../lib/usePersistentState";
import { FACTION_WARFARE_JUMP_DISTANCE_REFRESH_MS } from "../../lib/refreshIntervals";
import {
  isMilitiaFaction,
  warzoneForFaction,
  type MilitiaFactionId,
} from "./factionPerspective";
import {
  detectHomeDefenseAlerts,
  snapshotSystems,
  type NearbyFlipRadius,
  type SystemStateSnapshot,
} from "./homeDefenseAlerts";
import { FwHomeDefenseContext } from "./fwHomeDefenseContext";

const EMPTY_DIST: Record<string, number> = {};

/** Best-effort desktop notification — mirrors the private helper in
 *  useLocalIntelData.ts (not exported there, so duplicated rather than
 *  reaching across an unrelated module for a 6-line wrapper). */
async function notify(title: string, body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    /* notifications unavailable — nothing else to fall back to here */
  }
}

/**
 * Root-level provider (#907) for FW home-defense alerts: "a friendly system
 * went vulnerable" and "a nearby system flipped contested state". Mounted at
 * the app root (alongside {@link FightOverlayProvider}) so it keeps
 * evaluating no matter which module is on screen, the same pattern used
 * there.
 *
 * Reuses the exact same queries (same `queryKey`s, same `staleTime`s) the FW
 * page's own Warzone view already runs, rather than introducing a new
 * polling cadence: `["intel","fwSystems"]` for system state, and the jump
 * distance lookup at the same `FACTION_WARFARE_JUMP_DISTANCE_REFRESH_MS`
 * cadence Warzone already uses for that identical ESI-backed lookup — no
 * additional call frequency is introduced, only reused. The jump-distance
 * query only runs at all while the nearby-flip rule is enabled.
 *
 * Reads the "fw.militia" localStorage key directly (same key the FW page's
 * militia picker persists to) rather than sharing React state, so this
 * provider works independently of whether the FW page is mounted.
 */
export function FwHomeDefenseProvider({ children }: { children: ReactNode }) {
  const [vulnerableAlertOn, setVulnerableAlertOn] = usePersistentState<boolean>(
    "fw.homeDefense.vulnerableAlert",
    true,
  );
  const [nearbyFlipRadius, setNearbyFlipRadius] =
    usePersistentState<NearbyFlipRadius>(
      "fw.homeDefense.nearbyFlipRadius",
      "5",
    );

  // Same militia resolution as FactionWarfarePage (#901): an explicit
  // override (including explicit Observer) wins, else auto-detect from the
  // enlisted character.
  const [override] = usePersistentState<"observer" | MilitiaFactionId | null>(
    "fw.militia",
    null,
  );
  const characters = useQuery({
    queryKey: ["auth", "characters"],
    queryFn: authCharacters,
  });
  const hasCharacter = (characters.data?.length ?? 0) > 0;
  const rulesEnabled = vulnerableAlertOn || nearbyFlipRadius !== "off";
  const enlistment = useQuery({
    queryKey: ["intel", "fw-enlistment"],
    queryFn: intelFwEnlistment,
    enabled: hasCharacter && rulesEnabled,
    staleTime: 10 * 60_000,
  });
  const autoMilitia: MilitiaFactionId | null =
    enlistment.data != null && isMilitiaFaction(enlistment.data)
      ? enlistment.data
      : null;
  const myFaction: MilitiaFactionId | null =
    override != null && override !== "observer" ? override : autoMilitia;

  const map = useQuery({
    queryKey: ["intel", "fwSystems"],
    queryFn: fwSystems,
    staleTime: 5 * 60_000,
    enabled: myFaction != null && rulesEnabled,
  });

  // Only the militia's own warzone matters for either rule.
  const myWarzoneSystems = useMemo(() => {
    if (!myFaction || !map.data) return [];
    const zone = warzoneForFaction(myFaction);
    return map.data.nodes.filter((n) => n.warzone === zone);
  }, [map.data, myFaction]);
  const systemIds = useMemo(
    () => myWarzoneSystems.map((s) => s.systemId),
    [myWarzoneSystems],
  );

  const jumpsEnabled =
    hasCharacter && nearbyFlipRadius !== "off" && systemIds.length > 0;
  const jumpResult = useQuery({
    queryKey: ["intel", "fw-jumps", systemIds],
    queryFn: () => intelFwJumps(systemIds),
    enabled: jumpsEnabled,
    staleTime: FACTION_WARFARE_JUMP_DISTANCE_REFRESH_MS,
    refetchInterval: FACTION_WARFARE_JUMP_DISTANCE_REFRESH_MS,
  });
  const dist = useMemo(
    () => jumpResult.data?.jumps ?? EMPTY_DIST,
    [jumpResult.data],
  );

  const prevRef = useRef<Map<number, SystemStateSnapshot> | null>(null);
  useEffect(() => {
    if (!myFaction || myWarzoneSystems.length === 0) return;
    const alerts = detectHomeDefenseAlerts(
      prevRef.current,
      myWarzoneSystems,
      myFaction,
      dist,
      { vulnerableAlertOn, nearbyFlipRadius },
    );
    prevRef.current = snapshotSystems(myWarzoneSystems);
    for (const a of alerts) {
      if (a.kind === "vulnerable") {
        void notify(
          "⚠️ Home system vulnerable",
          `${a.systemName} is now vulnerable — defend it!`,
        );
      } else {
        void notify(
          "FW: nearby system flipped",
          `${a.systemName} is now ${a.contested}`,
        );
      }
    }
  }, [myWarzoneSystems, myFaction, dist, vulnerableAlertOn, nearbyFlipRadius]);

  return (
    <FwHomeDefenseContext.Provider
      value={{
        vulnerableAlertOn,
        setVulnerableAlertOn,
        nearbyFlipRadius,
        setNearbyFlipRadius,
      }}
    >
      {children}
    </FwHomeDefenseContext.Provider>
  );
}
