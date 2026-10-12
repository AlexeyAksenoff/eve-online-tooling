import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DpsEvent } from "../../lib/api";
import { formatClock } from "./dpsMeterShared";

/** Render one parsed combat-log line as plain English, e.g.
 *  "450 dmg → Some Pilot (Caracal) — Heavy Missile Launcher II [Wrecks]".
 *  Exported for unit testing. */
export function formatEventLine(e: DpsEvent): string {
  const who = `${e.pilot ?? "?"}${e.ship ? ` (${e.ship})` : ""}`;
  const via = e.weapon ? ` — ${e.weapon}` : "";
  switch (e.kind) {
    case "damageOut":
    case "damageIn": {
      const arrow = e.kind === "damageOut" ? "→" : "←";
      if (e.quality === "Misses") return `Misses ${arrow} ${who}${via}`;
      const q = e.quality ? ` [${e.quality}]` : "";
      return `${e.amount} dmg ${arrow} ${who}${via}${q}`;
    }
    case "repOut":
      return `${e.amount} repaired → ${who}`;
    case "repIn":
      return `${e.amount} repaired ← ${who}`;
    case "capTransferOut":
      return `${e.amount} GJ cap sent → ${who}`;
    case "capTransferIn":
      return `${e.amount} GJ cap received ← ${who}`;
    case "capWarfareOut":
      return `${e.amount} GJ cap neut'd → ${who}`;
    case "capWarfareIn":
      return `${e.amount} GJ cap neut'd ← ${who}`;
    case "scramOut":
      return `Scrambled → ${who}`;
    case "scramIn":
      return `Scrambled ← ${who}`;
    case "pointOut":
      return `Pointed → ${who}`;
    case "pointIn":
      return `Pointed ← ${who}`;
    case "mining":
      return `Mined ${e.amount} ${e.ore ?? "ore"}${e.volume > 0 ? ` (${e.volume.toFixed(0)} m³)` : ""}`;
  }
}

/** Text color by rough direction — outgoing (you did it) warm sky, incoming
 *  (done to you) cool rose, mining amber: the same warm/cool-out/in + amber
 *  convention as the rate charts (see `SERIES`/`TIMELINE_COLORS`). Misses are
 *  dimmed regardless of direction — noise, not signal. */
export function eventToneClass(e: DpsEvent): string {
  if (e.quality === "Misses") return "text-zinc-600";
  if (e.kind === "mining") return "text-amber-400";
  return e.kind.endsWith("Out") ? "text-sky-400" : "text-rose-400";
}

/** Collapsible, auto-scrolling combat log: one line per parsed event, newest
 *  at the bottom. Shared between the DPS meter page and the PVP fight
 *  overlay — both already feed from the same `dps://events` stream, so this
 *  only needs the buffered array and open/close state as props. */
export function CombatLogPanel({
  events,
  collapsed,
  onToggleCollapsed,
  className = "",
  maxHeightClass = "max-h-64",
}: {
  events: DpsEvent[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  className?: string;
  /** Tailwind max-height class for the scrolling list — the fight overlay's
   *  compact footer passes a shorter one than the DPS meter page. */
  maxHeightClass?: string;
}) {
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed && autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events.length, autoScroll, collapsed]);

  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-zinc-900/60 ${className}`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="flex flex-1 items-center gap-1.5 text-left text-sm font-medium text-zinc-300 hover:text-zinc-100"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          Combat log
          <span className="text-xs font-normal text-zinc-500">
            ({events.length})
          </span>
        </button>
        {!collapsed && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-indigo-500"
            />
            Auto-scroll
          </label>
        )}
      </div>
      {!collapsed && (
        <div
          className={`${maxHeightClass} overflow-y-auto border-t border-zinc-800 px-3 py-2 font-mono text-xs`}
        >
          {events.length === 0 ? (
            <p className="py-2 text-zinc-600">No combat events yet.</p>
          ) : (
            <>
              {events.map((e, i) => (
                <div key={i} className={`py-0.5 ${eventToneClass(e)}`}>
                  <span className="text-zinc-600">{formatClock(e.ts)}</span>{" "}
                  {formatEventLine(e)}
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
