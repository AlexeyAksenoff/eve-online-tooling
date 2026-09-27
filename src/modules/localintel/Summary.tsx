import { formatInt } from "../../lib/format";
import type { LocalScanResult } from "../../lib/api";
import { MILITIA_HEX } from "./militiaColors";

export function Summary({ result }: { result: LocalScanResult }) {
  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-4 text-sm">
        <span className="text-zinc-300">
          {formatInt(result.pilots.length)} pilots
        </span>
        <span className="text-rose-400">{formatInt(result.reds)} red</span>
        <span className="text-zinc-400">
          {formatInt(result.neutrals)} neutral
        </span>
        <span className="text-sky-400">{formatInt(result.blues)} blue</span>
      </div>
      {result.militiaCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
          {result.militiaCounts.map((m) => (
            <span key={m.militia} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: MILITIA_HEX[m.militia] ?? "#a1a1aa",
                }}
              />
              {m.militia}: {formatInt(m.count)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
