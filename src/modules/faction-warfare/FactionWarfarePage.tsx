import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Navigation } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  activeCharacter,
  authCharacters,
  errorMessage,
  fwSystems,
  intelFwEnlistment,
  intelFwJumps,
  intelFwPersonalStats,
  intelFwStats,
  setWaypoint,
  type FwJumpResult,
  type FwMap,
  type FwSystemNode,
} from "../../lib/api";
import { formatEveDateTime, formatInt, sortRows } from "../../lib/format";
import {
  SystemGraph,
  type SystemGraphNode,
  type SystemGraphEdge,
} from "../../components/SystemGraph";
import { Page, PageHeader } from "../../components/page";
import {
  SortHeaderCell,
  type SortColumn,
} from "../../components/SortHeaderCell";
import { InlineError } from "../../components/InlineError";
import { usePersistentSort } from "../../lib/usePersistentSort";
import { usePersistentState } from "../../lib/usePersistentState";
import { FACTION_WARFARE_JUMP_DISTANCE_REFRESH_MS } from "../../lib/refreshIntervals";
import {
  enemyFaction,
  isMilitiaFaction,
  militiaIdByName,
  perspectiveFor,
  relationshipFor,
  warzoneForFaction,
  MILITIA_NAME,
  type MilitiaFactionId,
  type Perspective,
} from "./factionPerspective";
import { trendTier, trendTooltip, TREND_ARROW } from "./vpTrend";
import { nearestFriendlyFrontline } from "./frontlineRoute";

/** The militia picker's selection: Observer (neutral, today's view) or one
 *  of the four militias. */
type MilitiaChoice = "observer" | MilitiaFactionId;

/** Picker button order, paired by warzone (Caldari/Gallente, then
 *  Amarr/Minmatar) so opposing militias sit next to each other. */
const MILITIA_PICKER_ORDER: readonly MilitiaFactionId[] = [
  500001, 500004, 500003, 500002,
];

/** The resolved militia perspective passed down to {@link Warzone}: `null`
 *  in Observer mode. */
type ActivePerspective = {
  myFaction: MilitiaFactionId;
  enemyFaction: MilitiaFactionId;
} | null;

/** Militia faction id → accent hex, used for the map + legend. */
const FACTION_HEX: Record<number, string> = {
  500001: "#38bdf8", // Caldari State
  500002: "#fb7185", // Minmatar Republic
  500003: "#fbbf24", // Amarr Empire
  500004: "#34d399", // Gallente Federation
};

/** Same colours keyed by faction name (the militia summary has no id). */
const FACTION_HEX_BY_NAME: Record<string, string> = {
  "Caldari State": "#38bdf8",
  "Minmatar Republic": "#fb7185",
  "Amarr Empire": "#fbbf24",
  "Gallente Federation": "#34d399",
};

/** Relationship → accent hex, used instead of {@link FACTION_HEX} once a
 *  militia is selected — friendly always renders the same colour regardless
 *  of *which* militia is "mine", so the map/legend read as "us vs them"
 *  rather than tracking a specific faction's usual palette. */
const RELATIONSHIP_HEX: Record<"friendly" | "hostile" | "cartel", string> = {
  friendly: "#34d399", // emerald
  hostile: "#fb7185", // rose
  cartel: "#a78bfa", // violet
};

/** Contested-state chip styles. */
const CONTEST_STYLE: Record<string, string> = {
  uncontested: "bg-zinc-700/40 text-zinc-400",
  contested: "bg-amber-500/15 text-amber-300",
  vulnerable: "bg-rose-500/15 text-rose-300",
  captured: "bg-emerald-500/15 text-emerald-300",
};

/** Contested-state → outline-ring hex on the map (uncontested = no ring). */
const CONTEST_RING: Record<string, string | undefined> = {
  contested: "#fbbf24",
  vulnerable: "#fb7185",
  captured: "#34d399",
};

/** Solid tile-background base per contest state (uncontested = plain dark). */
const BASE_RGB: [number, number, number] = [24, 24, 27]; // zinc-900
const CONTEST_RGB: Record<string, [number, number, number]> = {
  contested: [92, 71, 14], // solid amber
  vulnerable: [96, 30, 48], // solid rose
  captured: [16, 78, 56], // solid emerald
};
/** Colour the background deepens toward as a system's kills rise. */
const HEAT_RGB: [number, number, number] = [200, 32, 32];

/** Numeric rank for sorting contested state: uncontested → captured. */
const CONTEST_RANK: Record<string, number> = {
  uncontested: 0,
  contested: 1,
  vulnerable: 2,
  captured: 3,
};

/** Warzone-list filter: contested (any active contest — contested/vulnerable/
 *  captured), uncontested (quiet), or all. */
type FwSystemFilter = "all" | "contested" | "uncontested";
const FW_FILTERS: readonly { key: FwSystemFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "contested", label: "Contested" },
  { key: "uncontested", label: "Uncontested" },
];

/** Map height presets (#897). "fill" tracks the remaining viewport height
 *  via {@link useFillHeight} instead of a fixed pixel value. */
type FwMapSize = "s" | "m" | "l" | "fill";
const MAP_SIZE_PX: Record<Exclude<FwMapSize, "fill">, number> = {
  s: 320,
  m: 480,
  l: 720,
};
const FW_MAP_SIZES: readonly { key: FwMapSize; label: string }[] = [
  { key: "s", label: "S" },
  { key: "m", label: "M" },
  { key: "l", label: "L" },
  { key: "fill", label: "Fill" },
];

/** Proximity filter (#898): "within N jumps of me". Scopes both the table
 *  and the map; hidden without an active character (no jump data to filter
 *  by). "all" behaves exactly like the page did before this filter existed. */
type FwProximityRadius = "3" | "5" | "10" | "all";
const FW_PROXIMITY_OPTIONS: readonly {
  key: FwProximityRadius;
  label: string;
}[] = [
  { key: "3", label: "3j" },
  { key: "5", label: "5j" },
  { key: "10", label: "10j" },
  { key: "all", label: "All" },
];

type FwSortKey =
  | "name"
  | "region"
  | "occupier"
  | "perspectiveRank"
  | "battlefieldRank"
  | "contestedRank"
  | "vpPct"
  | "vpVelocity"
  | "kills"
  | "npcKills"
  | "jumps"
  | "hops";

const FW_SORT_KEYS: readonly FwSortKey[] = [
  "name",
  "region",
  "occupier",
  "perspectiveRank",
  "battlefieldRank",
  "contestedRank",
  "vpPct",
  "vpVelocity",
  "kills",
  "npcKills",
  "jumps",
  "hops",
];

/** Numeric rank for sorting battlefield class: frontline (most tactically
 *  relevant — active contact line) sorts ahead of rearguard. */
const BATTLEFIELD_RANK: Record<string, number> = {
  frontline: 0,
  commandops: 1,
  rearguard: 2,
};

/** Battlefield class → display label. */
const BATTLEFIELD_LABEL: Record<string, string> = {
  frontline: "Frontline",
  commandops: "Command Ops",
  rearguard: "Rearguard",
};

/** Battlefield class → chip style. Frontline pays 150% LP and is the only
 *  class with full plex spawns, so it gets the most attention-grabbing hue. */
const BATTLEFIELD_STYLE: Record<string, string> = {
  frontline: "bg-orange-500/15 text-orange-300",
  commandops: "bg-sky-500/15 text-sky-300",
  rearguard: "bg-zinc-700/40 text-zinc-400",
};

/** Derived (#895), not from ESI — see the backend's `classify_battlefield`
 *  doc comment for the frontline/command-ops/rearguard rules. */
const BATTLEFIELD_COLUMN: SortColumn<FwSortKey> = {
  key: "battlefieldRank",
  label: "Battlefield",
  numeric: false,
  description:
    "Frontline: borders enemy territory (150% LP, full plex spawns). Command Ops: a staging system just behind a friendly frontline. Rearguard: everything else.",
};

/** Sortable rank for the Defend/Push perspective column: the two
 *  actionable states sort ahead of "nothing to act on here". */
const PERSPECTIVE_RANK: Record<"defend" | "push" | "none", number> = {
  defend: 0,
  push: 1,
  none: 2,
};

/** The perspective column, spliced into {@link FW_COLUMNS} after "Controlled
 *  by" only while a militia (not Observer) is selected — Observer mode's
 *  table is otherwise unchanged. */
const PERSPECTIVE_COLUMN: SortColumn<FwSortKey> = {
  key: "perspectiveRank",
  label: "Perspective",
  numeric: false,
  description:
    "Defend: your militia holds it and it's under contest. Push: the enemy holds it and it's under contest.",
};

const FW_COLUMNS: SortColumn<FwSortKey>[] = [
  {
    key: "name",
    label: "System",
    numeric: false,
    description: "Solar system name",
  },
  {
    key: "region",
    label: "Region",
    numeric: false,
    description: "Region the system belongs to",
  },
  {
    key: "occupier",
    label: "Controlled by",
    numeric: false,
    description: "Faction currently occupying this system",
  },
  BATTLEFIELD_COLUMN,
  {
    key: "contestedRank",
    label: "State",
    numeric: false,
    description:
      "Contest state: uncontested → contested → vulnerable → captured",
  },
  {
    key: "vpPct",
    label: "Capture",
    numeric: true,
    description: "Victory-point capture progress (% toward flip)",
  },
  {
    key: "vpVelocity",
    label: "Trend",
    numeric: false,
    description:
      "Capture-progress velocity over the last ~30 min: ↑↑ fast gain, ↑ gain, → stable, ↓ falling. Blank until enough history exists.",
  },
  {
    key: "kills",
    label: "Kills 1h",
    numeric: true,
    description: "Ship kills in the last hour",
  },
  {
    key: "npcKills",
    label: "NPC Kills 1h",
    numeric: true,
    description:
      "NPC (rat) kills in the last hour — high NPC kills with low ship kills suggests active plex farming",
  },
  {
    key: "jumps",
    label: "Jumps 1h",
    numeric: true,
    description: "Stargate jumps through this system in the last hour",
  },
  {
    key: "hops",
    label: "Dist.",
    numeric: true,
    description: "Shortest stargate route from your current location",
  },
];

/** {@link FW_COLUMNS} with the Defend/Push column inserted after "Controlled
 *  by" — used in place of {@link FW_COLUMNS} once a militia is selected. */
const FW_COLUMNS_PERSPECTIVE: SortColumn<FwSortKey>[] = [
  ...FW_COLUMNS.slice(0, 3),
  PERSPECTIVE_COLUMN,
  ...FW_COLUMNS.slice(3),
];

/**
 * A tile's solid background: the contest-state base, deepened toward red as the
 * system's kills approach the warzone's busiest. Quiet uncontested systems keep
 * the default (transparent) background.
 */
function tileBg(
  contested: string,
  kills: number,
  maxKills: number,
): string | undefined {
  const base = CONTEST_RGB[contested] ?? BASE_RGB;
  const t = Math.min(1, kills / Math.max(10, maxKills)) * 0.75;
  if (t <= 0) {
    return contested === "uncontested" ? undefined : `rgb(${base.join(",")})`;
  }
  const mix = base.map((c, i) => Math.round(c + (HEAT_RGB[i] - c) * t));
  return `rgb(${mix.join(",")})`;
}

/**
 * Snap coordinate-placed tiles onto a grid so none overlap: each tile takes its
 * nearest cell, and collisions spiral out to the closest free one. Keeps the
 * rough geography while guaranteeing clear spacing. Pure.
 */
function spreadNoOverlap(
  points: { id: string; x: number; y: number }[],
  cellW: number,
  cellH: number,
): Map<string, { x: number; y: number }> {
  const order = [...points].sort((a, b) => a.y - b.y || a.x - b.x);
  const taken = new Set<string>();
  const out = new Map<string, { x: number; y: number }>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  for (const p of order) {
    let cx = Math.round(p.x / cellW);
    let cy = Math.round(p.y / cellH);
    if (taken.has(key(cx, cy))) {
      let done = false;
      for (let r = 1; r < 300 && !done; r++) {
        for (let dx = -r; dx <= r && !done; dx++) {
          for (let dy = -r; dy <= r && !done; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
            if (!taken.has(key(cx + dx, cy + dy))) {
              cx += dx;
              cy += dy;
              done = true;
            }
          }
        }
      }
    }
    taken.add(key(cx, cy));
    out.set(p.id, { x: cx * cellW, y: cy * cellH });
  }
  return out;
}

/**
 * "Fill" map size (#897): grows the map to the remaining viewport height
 * below its own top edge, tracking window resizes so it never needs a page
 * reload to re-fit. Inactive presets skip the resize listener entirely.
 */
function useFillHeight(
  active: boolean,
  minHeight: number,
): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(minHeight);
  useEffect(() => {
    if (!active) return;
    const compute = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      // 16px breathing room below the map so it doesn't touch the viewport edge.
      setHeight(Math.max(minHeight, window.innerHeight - top - 16));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [active, minHeight]);
  return [ref, height];
}

// Faction-warfare warzone view: pick a warzone, see the control map (systems
// coloured by who holds them) and a per-system table with contest state and
// last-hour activity. Public data, no login required.
export function FactionWarfarePage() {
  const stats = useQuery({
    queryKey: ["intel", "fw"],
    queryFn: intelFwStats,
    staleTime: 10 * 60_000,
  });
  const map = useQuery({
    queryKey: ["intel", "fwSystems"],
    queryFn: fwSystems,
    staleTime: 5 * 60_000,
  });

  // Warzones present in the data, in a stable order.
  const warzones = useMemo(() => {
    const seen = new Set<string>();
    for (const n of map.data?.nodes ?? []) if (n.warzone) seen.add(n.warzone);
    return [...seen].sort();
  }, [map.data]);
  const [zone, setZone] = useState<string | null>(null);

  // Militia perspective (#901): `override` is only set once the user
  // explicitly picks something (including explicitly picking Observer);
  // until then, default to the active character's enlisted militia if any.
  const [override, setOverride] = usePersistentState<MilitiaChoice | null>(
    "fw.militia",
    null,
  );
  const characters = useQuery({
    queryKey: ["auth", "characters"],
    queryFn: authCharacters,
  });
  const hasCharacter = (characters.data?.length ?? 0) > 0;
  const enlistment = useQuery({
    queryKey: ["intel", "fw-enlistment"],
    queryFn: intelFwEnlistment,
    enabled: hasCharacter,
    staleTime: 10 * 60_000,
  });
  const autoMilitia: MilitiaChoice =
    enlistment.data != null && isMilitiaFaction(enlistment.data)
      ? enlistment.data
      : "observer";
  const activeMilitia: MilitiaChoice = override ?? autoMilitia;
  const perspective: ActivePerspective = useMemo(
    () =>
      activeMilitia === "observer"
        ? null
        : {
            myFaction: activeMilitia,
            enemyFaction: enemyFaction(activeMilitia),
          },
    [activeMilitia],
  );

  // Personal FW stats card (#903): only fetched/shown once a militia is
  // actively selected — Observer mode has no "me" to report on.
  const personalStats = useQuery({
    queryKey: ["intel", "fw-personal-stats"],
    queryFn: intelFwPersonalStats,
    enabled: hasCharacter && perspective != null,
    staleTime: 10 * 60_000,
  });

  // Warzone is derived from the militia once one is selected; Observer mode
  // keeps the manual toggle.
  const activeZone = perspective
    ? warzoneForFaction(perspective.myFaction)
    : (zone ?? warzones[0] ?? null);

  // Militia summary strip: reordered mine-first/enemy-adjacent once a
  // militia is selected; Observer mode keeps the existing unordered list.
  const orderedStats = useMemo(() => {
    const rows = stats.data ?? [];
    if (!perspective) return rows;
    const rank = (name: string) => {
      const id = militiaIdByName(name);
      if (id === perspective.myFaction) return 0;
      if (id === perspective.enemyFaction) return 1;
      return 2;
    };
    return [...rows].sort((a, b) => rank(a.faction) - rank(b.faction));
  }, [stats.data, perspective]);

  return (
    <Page>
      <PageHeader
        title="Faction warfare"
        subtitle="Warzone control map and per-system state. Public data, no login required."
        actions={
          <button
            onClick={() => {
              stats.refetch();
              map.refetch();
            }}
            disabled={map.isFetching}
            className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {map.isFetching ? "Loading…" : "Refresh"}
          </button>
        }
      />

      {/* Militia perspective picker (#901): Observer (today's neutral view)
          or one of the four militias. Picking a militia reframes the page
          around it — the warzone is derived, the summary strip reorders, and
          the table/map gain a friend/foe read. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">Perspective</span>
        <div className="flex overflow-hidden rounded border border-zinc-700 text-sm">
          <button
            onClick={() => setOverride("observer")}
            className={`px-3 py-1 ${
              activeMilitia === "observer"
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            Observer
          </button>
          {MILITIA_PICKER_ORDER.map((id) => (
            <button
              key={id}
              onClick={() => setOverride(id)}
              className={`px-3 py-1 ${
                activeMilitia === id
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {MILITIA_NAME[id]}
            </button>
          ))}
        </div>
        {!override && autoMilitia !== "observer" && (
          <span className="text-xs text-zinc-600">
            auto-detected from your enlisted character
          </span>
        )}
      </div>

      {/* Militia summary strip (systems held / pilots / 24h kills). */}
      {orderedStats.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {orderedStats.map((s, i) => {
            const id = militiaIdByName(s.faction);
            const hex = perspective
              ? RELATIONSHIP_HEX[
                  id != null
                    ? relationshipFor(id, perspective.myFaction)
                    : "cartel"
                ]
              : (FACTION_HEX_BY_NAME[s.faction] ?? "#3f3f46");
            return (
              <div
                key={i}
                className="rounded-lg border border-l-4 border-zinc-800 bg-zinc-900/50 p-3"
                style={{ borderLeftColor: hex }}
              >
                <div className="truncate text-xs text-zinc-400">
                  {s.faction}
                  {perspective && id === perspective.myFaction && (
                    <span className="ml-1 text-emerald-400">(you)</span>
                  )}
                  {perspective && id === perspective.enemyFaction && (
                    <span className="ml-1 text-rose-400">(enemy)</span>
                  )}
                </div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-100">
                  {formatInt(s.systemsControlled)}
                  <span className="ml-1 text-xs font-normal text-zinc-500">
                    systems
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {formatInt(s.pilots)} pilots · {formatInt(s.killsYesterday)}{" "}
                  kills 24h
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Personal FW stats card (#903): only in the perspective view. */}
      {perspective && personalStats.data?.stats && (
        <div
          className="mt-4 rounded-lg border border-l-4 border-zinc-800 bg-zinc-900/50 p-3"
          style={{ borderLeftColor: RELATIONSHIP_HEX.friendly }}
        >
          <div className="text-xs text-zinc-400">
            Your record — {personalStats.data.stats.rankName}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-300">
            <span>
              {formatInt(personalStats.data.stats.killsYesterday)} kills
              yesterday · {formatInt(personalStats.data.stats.killsTotal)} total
            </span>
            <span>
              {formatInt(personalStats.data.stats.vpYesterday)} VP yesterday ·{" "}
              {formatInt(personalStats.data.stats.vpTotal)} total
            </span>
            <span>
              Enlisted{" "}
              {formatEveDateTime(personalStats.data.stats.enlistedOn).slice(
                0,
                10,
              )}
            </span>
          </div>
        </div>
      )}
      {perspective && personalStats.data?.missingScope && (
        <div className="mt-4 rounded border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
          Re-login to see your personal FW record — this character&apos;s token
          predates the read-fw-stats scope.
        </div>
      )}

      {/* Warzone selector — hidden once a militia is selected, since the
          warzone is then derived from it. */}
      {perspective ? (
        <div className="mt-5 flex items-center gap-2 text-xs text-zinc-500">
          <span>Warzone</span>
          <span className="rounded border border-zinc-700 px-3 py-1 text-zinc-300">
            {activeZone}
          </span>
          <span className="text-zinc-600">derived from your perspective</span>
        </div>
      ) : (
        warzones.length > 0 && (
          <div className="mt-5 flex items-center gap-2">
            <span className="text-xs text-zinc-500">Warzone</span>
            <div className="flex overflow-hidden rounded border border-zinc-700 text-sm">
              {warzones.map((w) => (
                <button
                  key={w}
                  onClick={() => setZone(w)}
                  className={`px-3 py-1 ${
                    activeZone === w
                      ? "bg-zinc-700 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        )
      )}

      {map.isLoading && (
        <div className="mt-5 text-sm text-zinc-500">Loading warzone map…</div>
      )}
      {map.isError && (
        <div className="mt-5 text-sm text-rose-400">
          {errorMessage(map.error)}
        </div>
      )}

      {map.data && activeZone && (
        <Warzone data={map.data} zone={activeZone} perspective={perspective} />
      )}
    </Page>
  );
}

function Warzone({
  data,
  zone,
  perspective,
}: {
  data: FwMap;
  zone: string;
  perspective: ActivePerspective;
}) {
  const systems = useMemo(
    () => data.nodes.filter((n) => n.warzone === zone),
    [data.nodes, zone],
  );

  // Warzone-list filter (persisted): contested/uncontested/all.
  const [filter, setFilter] = usePersistentState<FwSystemFilter>(
    "fw.systemFilter",
    "all",
  );

  // Map size preset (#897), persisted; "fill" tracks the viewport via the
  // resize-aware hook, the fixed presets are plain pixel heights.
  const [mapSize, setMapSize] = usePersistentState<FwMapSize>(
    "fw.mapSize",
    "m",
  );
  const [fillRef, fillHeight] = useFillHeight(mapSize === "fill", 320);
  const mapHeight = mapSize === "fill" ? fillHeight : MAP_SIZE_PX[mapSize];

  // Auth: needed for jump distances + waypoint button in the table.
  const characters = useQuery({
    queryKey: ["auth", "characters"],
    queryFn: authCharacters,
  });
  const hasCharacter = (characters.data?.length ?? 0) > 0;
  const activeChar = useQuery({
    queryKey: ["auth", "active"],
    queryFn: activeCharacter,
    enabled: hasCharacter,
  });
  // Jump distances from the active character's location to every system in this
  // warzone. Polled every 90 s so the map updates as the character moves.
  const systemIds = useMemo(() => systems.map((s) => s.systemId), [systems]);
  const jumpResult = useQuery<FwJumpResult>({
    queryKey: ["intel", "fw-jumps", systemIds],
    queryFn: () => intelFwJumps(systemIds),
    enabled: !!activeChar.data,
    staleTime: FACTION_WARFARE_JUMP_DISTANCE_REFRESH_MS,
    refetchInterval: FACTION_WARFARE_JUMP_DISTANCE_REFRESH_MS,
  });
  const dist = useMemo(() => jumpResult.data?.jumps ?? {}, [jumpResult.data]);
  const characterSystemId = jumpResult.data?.characterSystemId ?? null;

  // Route to frontline (#908): nearest friendly frontline by hop count,
  // ties broken toward fewer ship kills (safer arrival). Hidden without a
  // character or a militia perspective — Observer has no "friendly" side.
  const nearestFrontline = useMemo(
    () =>
      perspective && hasCharacter
        ? nearestFriendlyFrontline(systems, dist, perspective.myFaction)
        : null,
    [systems, dist, perspective, hasCharacter],
  );
  const navigate = useNavigate();
  const [frontlineError, setFrontlineError] = useState<string | null>(null);

  // Proximity filter (#898), persisted. "all" or no character → identical to
  // the unfiltered set; scopes both the table and the map together.
  const [radius, setRadius] = usePersistentState<FwProximityRadius>(
    "fw.proximityRadius",
    "all",
  );
  const visibleSystems = useMemo(() => {
    if (radius === "all" || !hasCharacter) return systems;
    const max = Number(radius);
    return systems.filter((s) => {
      const hops = dist[String(s.systemId)];
      return hops != null && hops <= max;
    });
  }, [systems, dist, radius, hasCharacter]);

  const ids = useMemo(
    () => new Set(visibleSystems.map((s) => s.systemId)),
    [visibleSystems],
  );

  const tableSystems = useMemo(() => {
    if (filter === "all") return visibleSystems;
    return visibleSystems.filter((s) =>
      filter === "contested"
        ? s.contested !== "uncontested"
        : s.contested === "uncontested",
    );
  }, [visibleSystems, filter]);

  // Lay the tiles out as a top-down star map from real galactic X/Z coords
  // (x → horizontal, z → vertical, flipped so north is up), scaled to fit.
  const graphNodes: SystemGraphNode[] = useMemo(() => {
    if (visibleSystems.length === 0) return [];
    const xs = visibleSystems.map((s) => s.x);
    const zs = visibleSystems.map((s) => s.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const span = Math.max(maxX - minX, maxZ - minZ) || 1;
    const scale = 2800 / span;
    const maxKills = Math.max(1, ...visibleSystems.map((s) => s.kills));
    // Scale by real coords (x → horizontal, z → vertical, north up), then snap
    // to a grid so no two tiles overlap on first load.
    const placed = spreadNoOverlap(
      visibleSystems.map((n) => ({
        id: String(n.systemId),
        x: (n.x - minX) * scale,
        y: (maxZ - n.z) * scale,
      })),
      168,
      66,
    );
    return visibleSystems.map((n) => {
      const p = placed.get(String(n.systemId)) ?? { x: 0, y: 0 };
      const hops = dist[String(n.systemId)];
      const isCurrent = n.systemId === characterSystemId;
      return {
        id: String(n.systemId),
        label: n.name,
        kind: "lowsec" as const,
        sub: `${n.security.toFixed(1)}${
          n.battlefield !== "rearguard"
            ? ` · ${BATTLEFIELD_LABEL[n.battlefield] ?? n.battlefield}`
            : ""
        }${n.contested !== "uncontested" ? ` · ${n.contested}` : ""}${(() => {
          const tier = trendTier(n.vpVelocity);
          return tier ? ` ${TREND_ARROW[tier]}` : "";
        })()}${
          n.kills > 0 || n.npcKills > 0
            ? ` · ${n.kills} kills${n.npcKills > 0 ? ` (${n.npcKills} npc)` : ""}`
            : ""
        }${hops != null ? ` · ${isCurrent ? "here" : `${hops}j`}` : ""}`,
        accent: perspective
          ? RELATIONSHIP_HEX[
              relationshipFor(n.occupierId, perspective.myFaction)
            ]
          : (FACTION_HEX[n.occupierId] ?? "#a1a1aa"),
        ring: CONTEST_RING[n.contested],
        bg: tileBg(n.contested, n.kills, maxKills),
        current: isCurrent,
        group: n.region,
        x: p.x,
        y: p.y,
      };
    });
  }, [visibleSystems, dist, characterSystemId, perspective]);
  const graphEdges: SystemGraphEdge[] = data.edges
    .filter(([a, b]) => ids.has(a) && ids.has(b))
    .map(([a, b]) => ({
      source: String(a),
      target: String(b),
      variant: "stargate",
    }));

  // Colour legend for the factions present in this warzone.
  const factions = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of visibleSystems) m.set(s.occupierId, s.occupier);
    return [...m.entries()];
  }, [visibleSystems]);

  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">Show</span>
        <div className="flex overflow-hidden rounded border border-zinc-700 text-sm">
          {FW_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1 ${
                filter === f.key
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {hasCharacter && (
          <>
            <span className="text-xs text-zinc-500">Within</span>
            <div className="flex overflow-hidden rounded border border-zinc-700 text-sm">
              {FW_PROXIMITY_OPTIONS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRadius(r.key)}
                  className={`px-3 py-1 ${
                    radius === r.key
                      ? "bg-zinc-700 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </>
        )}
        <span className="text-xs text-zinc-600">
          {tableSystems.length} of {visibleSystems.length} systems
        </span>
      </div>

      {nearestFrontline && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Route to frontline</span>
          <button
            onClick={() =>
              navigate("/route", {
                state: {
                  destination: {
                    id: nearestFrontline.systemId,
                    name: nearestFrontline.name,
                  },
                },
              })
            }
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            {nearestFrontline.name} ({dist[String(nearestFrontline.systemId)]}j)
          </button>
          <div className="group relative">
            <button
              onClick={() =>
                setWaypoint(nearestFrontline.systemId)
                  .then(() => setFrontlineError(null))
                  .catch((e) => {
                    console.error(
                      `Failed to set destination ${nearestFrontline.name}`,
                      e,
                    );
                    setFrontlineError(
                      `Couldn't set destination: ${errorMessage(e)}`,
                    );
                  })
              }
              aria-label="Set in-game waypoint to nearest frontline"
              className="text-zinc-500 hover:text-indigo-400"
            >
              <Navigation size={14} />
            </button>
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 ring-1 ring-zinc-700 group-hover:block">
              Set route
            </span>
          </div>
          <InlineError
            message={frontlineError}
            className="text-xs text-rose-400"
          />
        </div>
      )}
      <SystemTable
        systems={tableSystems}
        dist={dist}
        hasCharacter={hasCharacter}
        perspective={perspective}
      />

      <div className="mt-4 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-400">
        <span>{visibleSystems.length} systems</span>
        {perspective
          ? (["friendly", "hostile", "cartel"] as const).flatMap((rel) =>
              factions
                .filter(
                  ([id]) => relationshipFor(id, perspective.myFaction) === rel,
                )
                .map(([id, name]) => (
                  <span key={id} className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: RELATIONSHIP_HEX[rel] }}
                    />
                    <span className="capitalize text-zinc-500">{rel}:</span>{" "}
                    {name}
                  </span>
                )),
            )
          : factions.map(([id, name]) => (
              <span key={id} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: FACTION_HEX[id] ?? "#a1a1aa" }}
                />
                {name}
              </span>
            ))}
        <span className="text-zinc-600">·</span>
        {(["contested", "vulnerable", "captured"] as const).map((c) => (
          <span key={c} className="flex items-center gap-1.5 capitalize">
            <span
              className="h-2.5 w-2.5 rounded-sm ring-2"
              style={{ boxShadow: `0 0 0 2px ${CONTEST_RING[c]}` }}
            />
            {c}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "rgb(200,32,32)" }}
          />
          more kills
        </span>
        <span className="text-zinc-600">· star map — drag to arrange</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-zinc-600">Size</span>
          <span className="flex overflow-hidden rounded border border-zinc-700">
            {FW_MAP_SIZES.map((s) => (
              <button
                key={s.key}
                onClick={() => setMapSize(s.key)}
                className={`px-2 py-0.5 ${
                  mapSize === s.key
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {s.label}
              </button>
            ))}
          </span>
        </span>
      </div>

      <div
        ref={fillRef}
        className="overflow-hidden rounded-lg border border-zinc-800"
      >
        <SystemGraph
          nodes={graphNodes}
          edges={graphEdges}
          height={mapHeight}
          storageKey={`fw-map3-${zone}`}
        />
      </div>
    </div>
  );
}

function SystemTable({
  systems,
  dist,
  hasCharacter,
  perspective,
}: {
  systems: FwSystemNode[];
  /** Hop counts keyed by String(systemId), from the active character's location. */
  dist: Record<string, number>;
  hasCharacter: boolean;
  perspective: ActivePerspective;
}) {
  const { sortKey, sortDir, toggleSort } = usePersistentSort<FwSortKey>(
    "sort.fw-systems",
    FW_SORT_KEYS,
    "name",
    "asc",
    ["name", "region", "occupier"],
  );
  const columns = perspective ? FW_COLUMNS_PERSPECTIVE : FW_COLUMNS;

  // Augment rows with sort-friendly scalar fields, then sort.
  const rows = useMemo(() => {
    type AugRow = FwSystemNode & {
      contestedRank: number;
      hops: number | null;
      perspective: Perspective;
      perspectiveRank: number;
      battlefieldRank: number;
    };
    const augmented: AugRow[] = systems.map((s) => {
      const persp = perspective
        ? perspectiveFor(s.occupierId, s.contested, perspective.myFaction)
        : null;
      return {
        ...s,
        contestedRank: CONTEST_RANK[s.contested] ?? 0,
        hops: dist[String(s.systemId)] ?? null,
        perspective: persp,
        perspectiveRank: PERSPECTIVE_RANK[persp ?? "none"],
        battlefieldRank: BATTLEFIELD_RANK[s.battlefield] ?? 2,
      };
    });
    return sortRows(augmented, sortKey, sortDir, {
      nullsLast: sortKey === "hops" || sortKey === "vpVelocity",
    });
  }, [systems, dist, sortKey, sortDir, perspective]);

  return (
    <div className="overflow-auto rounded-lg border border-zinc-800">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-zinc-900">
          <tr>
            {columns.map((col) => (
              <SortHeaderCell
                key={col.key}
                column={col}
                active={sortKey === col.key}
                dir={sortDir}
                onClick={toggleSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr
              key={s.systemId}
              className="border-t border-zinc-800 text-zinc-300"
            >
              <SystemNameCell s={s} hasCharacter={hasCharacter} />
              <td className="px-3 py-1.5 text-zinc-500">{s.region}</td>
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: perspective
                        ? RELATIONSHIP_HEX[
                            relationshipFor(s.occupierId, perspective.myFaction)
                          ]
                        : (FACTION_HEX[s.occupierId] ?? "#a1a1aa"),
                    }}
                  />
                  {s.occupier}
                </span>
              </td>
              <td className="px-3 py-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                    BATTLEFIELD_STYLE[s.battlefield] ??
                    BATTLEFIELD_STYLE.rearguard
                  }`}
                >
                  {BATTLEFIELD_LABEL[s.battlefield] ?? s.battlefield}
                </span>
              </td>
              {perspective && (
                <td className="px-3 py-1.5">
                  {s.perspective ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                        s.perspective === "defend"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-rose-500/15 text-rose-300"
                      }`}
                    >
                      {s.perspective}
                    </span>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
              )}
              <td className="px-3 py-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                    CONTEST_STYLE[s.contested] ?? CONTEST_STYLE.uncontested
                  }`}
                >
                  {s.contested}
                </span>
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400">
                {s.contested === "uncontested"
                  ? "—"
                  : `${Math.round(s.vpPct * 100)}%`}
              </td>
              <td
                className="px-3 py-1.5 text-center tabular-nums text-zinc-400"
                title={trendTooltip(s.vpPct, s.vpVelocity)}
              >
                {(() => {
                  const tier = trendTier(s.vpVelocity);
                  return tier ? TREND_ARROW[tier] : "—";
                })()}
              </td>
              <td
                className={`px-3 py-1.5 text-right tabular-nums ${
                  s.kills > 0 ? "text-rose-300" : "text-zinc-600"
                }`}
              >
                {s.kills > 0 ? formatInt(s.kills) : "—"}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500">
                {s.npcKills > 0 ? formatInt(s.npcKills) : "—"}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400">
                {s.jumps > 0 ? formatInt(s.jumps) : "—"}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400">
                {s.hops != null
                  ? s.hops === 0
                    ? "here"
                    : formatInt(s.hops)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** System-name cell: Dotlan link + optional "set route" waypoint button. Owns
 *  its own inline-error state (#819/#820) since it's repeated per row — an
 *  openUrl/setWaypoint failure here shouldn't blow away the whole table with
 *  a blocking alert(), just note it next to the control that failed. */
function SystemNameCell({
  s,
  hasCharacter,
}: {
  s: FwSystemNode;
  hasCharacter: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <td className="px-3 py-1.5">
      <div className="flex items-center gap-2">
        {/* System name → Dotlan for map + info (ESI can't open an
            in-game info window for solar systems, esi-issues#358). */}
        <button
          onClick={() =>
            void openUrl(`https://evemaps.dotlan.net/system/${s.name}`)
              .then(() => setError(null))
              .catch((e) => {
                console.error(`Failed to open ${s.name} on Dotlan`, e);
                setError(`Couldn't open Dotlan: ${errorMessage(e)}`);
              })
          }
          title={`Open ${s.name} on Dotlan`}
          className="font-medium text-zinc-100 hover:text-indigo-300"
        >
          {s.name}
        </button>
        {hasCharacter && (
          <div className="group relative">
            <button
              onClick={() =>
                setWaypoint(s.systemId)
                  .then(() => setError(null))
                  .catch((e) => {
                    console.error(`Failed to set destination ${s.name}`, e);
                    setError(`Couldn't set destination: ${errorMessage(e)}`);
                  })
              }
              className="text-zinc-600 hover:text-indigo-400"
            >
              <Navigation size={12} />
            </button>
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 ring-1 ring-zinc-700 group-hover:block">
              Set route
            </span>
          </div>
        )}
      </div>
      <InlineError message={error} className="mt-0.5 text-xs text-rose-400" />
    </td>
  );
}
