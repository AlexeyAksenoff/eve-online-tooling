import { useState } from "react";
import { RefreshCw } from "lucide-react";

import {
  formatIsk,
  formatSignedIsk,
  formatSignedPercent,
  formatDuration,
  formatInt,
  unitCost,
} from "../../lib/format";
import { EmptyState } from "../../components/EmptyState";
import { useCopyToClipboard } from "../../lib/useCopyToClipboard";
import type { WorkbenchState } from "./workbenchTypes";
import type { ProfitBreakdown } from "../../lib/api";

/** Tabs within the Build Planner results panel. */
const RESULT_TABS = ["profit", "materials", "reactions"] as const;
type ResultTab = (typeof RESULT_TABS)[number];

/** Build Planner results: three tabs — profit summary, materials to buy,
 *  and reaction plan. Reads from `wb.buildProfit.data`. */
export function BuildResults({ wb }: { wb: WorkbenchState }) {
  const { buildProfit } = wb;
  const { data: bd, isPending, isError, error } = buildProfit;
  const [tab, setTab] = useState<ResultTab>("profit");

  if (isError) {
    return (
      <div className="text-sm text-rose-400">
        Calculation failed: {error?.message ?? "unknown error"}
      </div>
    );
  }

  if (isPending) {
    return (
      <EmptyState
        title="Pricing…"
        hint="Evaluating this single blueprint’s full build tree."
      />
    );
  }

  if (!bd) {
    return (
      <EmptyState
        title="Not priced yet"
        hint="Complete the wizard steps and click Calculate in Step 4."
      />
    );
  }

  return (
    <>
      <div className="mb-3 inline-flex rounded border border-zinc-800 bg-zinc-900 p-0.5">
        {RESULT_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-sm ${
              tab === t
                ? "bg-indigo-600 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t === "profit"
              ? "Profit"
              : t === "materials"
                ? "Materials"
                : "Reactions"}
          </button>
        ))}
      </div>

      {tab === "profit" && <ProfitTab bd={bd} />}
      {tab === "materials" && <MaterialsTab bd={bd} />}
      {tab === "reactions" && <ReactionsTab bd={bd} />}
    </>
  );
}

/** Profit summary: headline numbers + breakdown table. */
function ProfitTab({ bd }: { bd: ProfitBreakdown }) {
  return (
    <div className="space-y-4">
      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric
          label="Profit"
          value={formatSignedIsk(bd.profit)}
          color={bd.profit >= 0}
        />
        <Metric
          label="Margin"
          value={formatSignedPercent(bd.margin)}
          color={bd.margin != null && bd.margin >= 0}
        />
        <Metric
          label="ROI"
          value={formatSignedPercent(bd.roi)}
          color={bd.roi != null && bd.roi >= 0}
        />
        <Metric
          label="Cost / unit"
          value={formatIsk(unitCost(bd) ?? 0)}
          color={true}
        />
      </div>

      {/* Revenue / cost breakdown */}
      <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
        <table className="w-full text-xs">
          <tbody>
            <BreakdownRow
              label="Revenue (sell)"
              value={formatIsk(bd.revenue)}
            />
            <BreakdownRow
              label="Materials"
              value={formatIsk(bd.materialCost)}
            />
            <BreakdownRow label="Job fee" value={formatIsk(bd.jobFee)} />
            {bd.blueprintCost > 0 && (
              <BreakdownRow
                label="Blueprint"
                value={formatIsk(bd.blueprintCost)}
              />
            )}
            {bd.inventionCost > 0 && (
              <BreakdownRow
                label="Invention"
                value={formatIsk(bd.inventionCost)}
              />
            )}
            <BreakdownRow
              label="Manufacturing time"
              value={formatDuration(bd.manufacturingTimeSeconds)}
              sub
            />
            {bd.reactionTimeSeconds > 0 && (
              <BreakdownRow
                label="Reaction time"
                value={formatDuration(bd.reactionTimeSeconds)}
                sub
              />
            )}
            <BreakdownRow
              label="Units produced"
              value={formatInt(bd.unitsProduced)}
              sub
            />
            <tr className="border-t border-zinc-800 font-medium">
              <td className="py-1">Profit</td>
              <td className="text-right tabular-nums">
                {formatSignedIsk(bd.profit)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {bd.missingPrices.length > 0 && (
        <div className="text-xs text-amber-400">
          Missing prices for {bd.missingPrices.length} type id(s) — numbers may
          be incomplete.
        </div>
      )}
    </div>
  );
}

/** Materials tab: what to buy, with stock-adjusted shortfall + Multibuy. */
function MaterialsTab({ bd }: { bd: ProfitBreakdown }) {
  const { copied, copy } = useCopyToClipboard();

  // Aggregate by built vs bought, and compute total buy shortfall.
  const buyLines = bd.materials.filter((m) => !m.built);
  const buildLines = bd.materials.filter((m) => m.built);

  function multibuyText(): string {
    return bd.materials
      .map((m) => ({
        name: m.name,
        qty: Math.max(0, m.requiredQuantity - m.have),
      }))
      .filter((m) => m.qty > 0)
      .map((m) => `${m.name}\t${m.qty}`)
      .join("\n");
  }

  function copyCsv(): string {
    return bd.materials
      .map((m) => {
        const buy = Math.max(0, m.requiredQuantity - m.have);
        return `${m.name},${m.requiredQuantity},${m.have},${buy}`;
      })
      .join("\n");
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          onClick={() => copy(multibuyText())}
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          {copied ? "Copied ✓" : "Copy Multibuy"}
        </button>
        <button
          onClick={() => copy(copyCsv())}
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Copy CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="w-full text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="text-left font-medium">Material</th>
              <th className="text-right font-medium">Required</th>
              <th className="text-right font-medium">Have</th>
              <th className="text-right font-medium">Buy</th>
              <th className="text-right font-medium">Unit price</th>
              <th className="text-right font-medium">Line cost</th>
            </tr>
          </thead>
          <tbody>
            {bd.materials.map((m) => {
              const buy = Math.max(0, m.requiredQuantity - m.have);
              return (
                <tr key={m.typeId} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1 text-zinc-200">
                    {m.name}
                    {m.built && (
                      <span className="text-xs text-zinc-500"> (built)</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatInt(m.requiredQuantity)}
                  </td>
                  <td className="text-right tabular-nums text-zinc-400">
                    {formatInt(m.have)}
                  </td>
                  <td className="text-right tabular-nums text-emerald-400">
                    {formatInt(buy)}
                  </td>
                  <td className="text-right tabular-nums text-zinc-400">
                    {m.unitPrice == null ? "—" : formatIsk(m.unitPrice)}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatIsk(m.lineCost)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {buildLines.length > 0 && (
        <div className="text-xs text-zinc-500">
          {buildLines.length} material(s) are built (cheaper than buying)
        </div>
      )}

      {buyLines.length > 0 && (
        <div className="text-xs text-zinc-500">
          {buyLines.length} material(s) are bought at market
        </div>
      )}
    </div>
  );
}

/** Reactions tab: what reaction formulas to run, how many runs, reagents. */
function ReactionsTab({ bd }: { bd: ProfitBreakdown }) {
  const { copied, copy } = useCopyToClipboard();
  const { lines, totalInstallCost } = bd.reactions;

  if (lines.length === 0) {
    return (
      <EmptyState
        title="No reactions needed"
        hint="This build doesn't require any reaction formulas — all materials can be bought at market."
      />
    );
  }

  function allReagentsMultibuy(): string {
    return lines
      .flatMap((line) =>
        line.inputs.map((m) => `${m.name}\t${m.requiredQuantity}`),
      )
      .join("\n");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-400">
          {lines.length} formula({lines.length === 1 ? "" : "s"}) ·{" "}
          {formatIsk(totalInstallCost)} total install cost
        </div>
        <button
          onClick={() => copy(allReagentsMultibuy())}
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          {copied ? "Copied ✓" : "Copy all reagents (Multibuy)"}
        </button>
      </div>

      <div className="space-y-3">
        {lines.map((line) => (
          <ReactionLine
            key={`${line.blueprintTypeId}-${line.productTypeId}`}
            line={line}
          />
        ))}
      </div>
    </div>
  );
}

/** One reaction formula with its runs and reagents. */
function ReactionLine({
  line,
}: {
  line: {
    blueprintTypeId: number;
    productTypeId: number;
    productName: string;
    productPerRun: number;
    runs: number;
    inputs: {
      typeId: number;
      name: string;
      requiredQuantity: number;
      lineCost: number;
    }[];
  };
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className="rounded border border-zinc-800 bg-zinc-900/40 p-3 cursor-pointer hover:bg-zinc-800/40"
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-zinc-200">{line.productName}</span>
          <span className="mx-2 text-zinc-500">·</span>
          <span className="text-sm text-zinc-400">
            {line.runs} run{line.runs !== 1 ? "s" : ""} ({line.productPerRun}{" "}
            units/run)
          </span>
        </div>
        <RefreshCw
          size={14}
          className={`text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </div>

      {expanded && (
        <div className="mt-2 space-y-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th className="text-left font-medium">Reagent</th>
                <th className="text-right font-medium">Qty</th>
                <th className="text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {line.inputs.map((m) => (
                <tr key={m.typeId} className="border-t border-zinc-800/40">
                  <td className="py-0.5 text-zinc-200">{m.name}</td>
                  <td className="text-right tabular-nums">
                    {formatInt(m.requiredQuantity)}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatIsk(m.lineCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Small metric card for the profit summary. */
function Metric({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color: boolean;
  sub?: boolean;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
      <div className="text-xs text-zinc-400">{label}</div>
      <div
        className={`text-lg font-semibold tabular-nums ${
          sub ? "text-zinc-300" : color ? "text-emerald-400" : "text-rose-400"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** A single row in the profit breakdown table. */
function BreakdownRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: boolean;
}) {
  return (
    <tr>
      <td className={`py-1 ${sub ? "text-zinc-400" : "text-zinc-300"}`}>
        {label}
      </td>
      <td className="text-right tabular-nums">{value}</td>
    </tr>
  );
}
