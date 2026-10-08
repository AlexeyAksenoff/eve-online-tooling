import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  productionSystemCostIndex,
  systemSearch,
  type SystemMatch,
} from "../../lib/api";
import { Combo } from "../../components/Combo";
import { Field } from "../../components/forms";

/** Facility cost-index fraction (0..1) with a build-system lookup that fills
 * it from live ESI `/industry/systems/`. `null` = wormhole / manual override.
 *
 * Adapted from the original percent-based field (#888) so each facility
 * profile can pin a different system's index, with the same live-fill + stale
 * fallback behaviour (serves the on-disk index map if ESI refresh fails).
 *
 * `systemId`/`onSystemChange` let the caller persist the chosen system so it
 * survives profile switches. */
export function CostIndexField({
  value,
  onChange,
  systemId,
  onSystemChange,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  systemId: number | null;
  onSystemChange: (id: number | null) => void;
}) {
  const [picked, setPicked] = useState<SystemMatch | null>(null);

  // Sync `picked` to the latest systemId — full reset on change, so that
  // switching facility tabs (each with its OWN systemId) loads the correct
  // system instead of keeping the stale one from the previous tab.
  useEffect(() => {
    if (systemId != null) {
      setPicked({ id: systemId, name: "" });
    } else {
      // Wormhole / manual override — no pinned system, keep whatever the
      // user typed as `value`.
      setPicked(null);
    }
        // We intentionally watch ONLY systemId: each tab owns its systemId, so a
    // change always means "load this system". React strict-mode double‑invoke
    // is harmless here (setPicked to the same id is a no‑op).
  }, [systemId]);

  // Sync changes back to the caller so systemId survives profile switches.
  useEffect(() => {
    onSystemChange(picked?.id ?? null);
  }, [picked, onSystemChange]);
  const idx = useQuery({
    queryKey: ["production", "costIndex", picked?.id],
    queryFn: picked ? () => productionSystemCostIndex(picked.id) : undefined,
    enabled: picked != null,
    staleTime: 60 * 60 * 1000,
  });
  // Fill the field from the live index when a system resolves.
  useEffect(() => {
    if (picked && typeof idx.data === "number") {
      onChange(parseFloat(idx.data.toFixed(4)));
    }
  }, [idx.data, picked, onChange]);

  return (
    <Field label="Cost index (fraction, from system)">
      <input
        type="number"
        value={value == null ? "" : String(value)}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : null)
        }
        step={0.001}
        min={0}
        max={1}
        placeholder="↳ fill from a build system…"
        className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
      />
      <div className="mt-1">
        <Combo
          value={picked}
          onPick={setPicked}
          search={systemSearch}
          placeholder="↳ fill from a build system…"
          width="w-full"
          maxResults={8}
        />
      </div>
      {picked && idx.isLoading && (
        <span className="text-[10px] text-zinc-500">
          Loading {picked.name}…
        </span>
      )}
      {picked && !idx.isLoading && typeof idx.data === "number" && (
        <span className="text-[10px] text-emerald-500">
          {picked.name}: {(idx.data * 100).toFixed(2)}% (live)
        </span>
      )}
      {picked && !idx.isLoading && idx.data == null && (
        <span className="text-[10px] text-amber-400">
          No live index for {picked.name} — keeping your value
        </span>
      )}
    </Field>
  );
}
