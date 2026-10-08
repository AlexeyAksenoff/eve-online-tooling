import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { productionRigs, type RigTypeInfo } from "../../lib/api/production";
import type { FacilityType } from "./types";

/** Searchable multiselect for facility rigs, replacing the old checkbox list.
 *  Options come from the backend `production_rigs` command (SDE‑backed),
 *  filtered to rigs whose slot size **exactly** matches `maxRigSize` — so a
 *  size‑3 rig is never offered on a Medium (Athanor/Raitaru) structure, only on
 *  a Large/ XL one (Tatara / Sotiyo). Multiple rigs may be selected; each is
 *  shown as a removable tag. The parent recomputes ME/TE/cost via
 *  `applyRigBonuses` on `onChange` (security scaling reads each rig's own
 *  dogma modifiers, not the legacy security multiplier). */
export function MultiCombo({
  facilityType,
  maxRigSize,
  selectedIds,
  onChange,
}: {
  facilityType: FacilityType;
  maxRigSize: number;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const {
    data: all = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["production", `rigs-${facilityType}-${maxRigSize}`],
    queryFn: () => productionRigs(facilityType, maxRigSize),
    staleTime: Infinity,
  });
  const [text, setText] = useState("");
  const selected = new Set(selectedIds);
  const available = all.filter((r) => !selected.has(r.typeId));
  const needle = text.trim().toLowerCase();
  const filtered = needle
    ? available.filter((r) => r.name.toLowerCase().includes(needle))
    : available;

  const SIZE_NAME = ["", "S", "M", "L", "XL"];

  function add(id: number) {
    onChange([...selectedIds, id]);
    setText("");
  }
  function remove(id: number) {
    onChange(selectedIds.filter((i) => i !== id));
  }
  function byId(id: number): RigTypeInfo | undefined {
    return all.find((r) => r.typeId === id);
  }

  return (
    <div className="space-y-1.5 text-sm">
      {/* Selected rigs as removable tags. */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => {
            const r = byId(id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.25 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200"
              >
                <span className={r?.isT2 ? "text-amber-300" : "text-zinc-300"}>
                  {r?.tier}:
                </span>{" "}
                {r ? r.name : `rig #${id}`}
                <span className="text-zinc-500">(+{r?.bonus ?? 0}%)</span>
                <button
                  type="button"
                  onClick={() => remove(id)}
                  className="rounded border border-zinc-700 px-1 text-xs text-zinc-400 hover:bg-zinc-900"
                  title="Remove"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Search box: filter by name, or paste a typeID number. */}
      <input
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const trimmed = text.trim().replace(/\s+/g, " ");
          // A bare number → treat as a typeID (lets you paste/type an ID).
          if (/^\d+$/.test(trimmed)) {
            const id = Number(trimmed);
            if (!selectedIds.includes(id)) {
              e.preventDefault();
              add(id);
            }
            return;
          }
          if (filtered.length === 1) {
            e.preventDefault();
            add(filtered[0].typeId);
          }
        }}
        disabled={maxRigSize === 0 || isLoading || all.length === 0}
        placeholder={
          maxRigSize === 0
            ? "no rig slots on this structure"
            : "start typing a rig name…"
        }
        className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:opacity-50"
      />

      {isError && (
        <span className="text-[10px] text-rose-400">
          Failed to load rigs (SDE not installed?).
        </span>
      )}

      {text && !isError && filtered.length > 0 && (
        <div className="max-h-52 overflow-auto rounded border border-zinc-700 bg-zinc-900 text-sm">
          {filtered.slice(0, 12).map((r) => (
            <button
              key={r.typeId}
              type="button"
              onClick={() => add(r.typeId)}
              className="block w-full px-2 py-1 text-left text-zinc-300 hover:bg-zinc-800"
            >
              <span className={r.isT2 ? "text-amber-300" : "text-zinc-300"}>
                {r.tier}:
              </span>{" "}
              <span className="text-zinc-200">{r.name}</span>
              <span className="text-zinc-500"> (+{r.bonus}%</span>
              {r.meBonus > 0 ? ` ME` : ""} {r.teBonus > 0 ? `TE` : ""}{" "}
              {r.costBonus > 0 ? `cost` : ""}
              {")"}
            </button>
          ))}
        </div>
      )}

      {/* Small status line. */}
      {maxRigSize > 0 && (
        <span className="text-[10px] text-zinc-500">
          {isLoading
            ? "Loading rigs…"
            : isError
              ? ""
              : `${all.length} rig(s) fit a ${SIZE_NAME[maxRigSize]}‑slot structure`}
        </span>
      )}
    </div>
  );
}
