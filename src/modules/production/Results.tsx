import { errorMessage } from "../../lib/api";
import {
  BlueprintLibrary,
  FilterChips,
  ListView,
  PasteVerdict,
  StaleBar,
  ViewTabs,
} from "./components";
import { ProfitTable, TableSkeleton } from "./ProfitTable";
import { BuildResults } from "./BuildResults";
import { facilityProfileLabel, isApproximate } from "./facilityProfiles";
import type { WorkbenchState } from "./workbenchTypes";

export function Results({ wb }: { wb: WorkbenchState }) {
  const {
    view,
    setView,
    favorites,
    blacklist,
    owned,
    imported,
    activeFilters,
    resetAllFilters,
    pasteVerdict,
    pasteMinRoi,
    profit,
    rows,
    filtered,
    regionId,
    regions,
    stationId,
    stations,
    toggleFavorite,
    blacklistRow,
    rowsByType,
    setList,
    saveImported,
    isStale,
    dirtyCount,
    autoRecalc,
    setAutoRecalc,
    calculate,
    setBuildBlueprintTypeId,
    setBuildSearchResult,
    setBuildBpMe,
    setBuildBpTe,
    setBuildRuns,
    ownedMe,
    ownedTe,
    me,
    te,
  } = wb;

  return (
    <>
      <ViewTabs
        view={view}
        onChange={setView}
        counts={{
          favorites: favorites.data?.length ?? 0,
          blacklist: blacklist.data?.length ?? 0,
          library: (owned.data?.length ?? 0) + imported.length,
        }}
      />

      {view === "opportunities" && activeFilters.length > 0 && (
        <FilterChips filters={activeFilters} onReset={resetAllFilters} />
      )}

      {view === "opportunities" && pasteVerdict && (
        <PasteVerdict
          worth={pasteVerdict.worth}
          skip={pasteVerdict.skip}
          notBuildable={pasteVerdict.notBuildable}
          minRoiPct={pasteMinRoi * 100}
        />
      )}

      {/* Facility + stock indicator — shows what's applied to the current pricing */}
      {view === "opportunities" && <FacilityIndicator wb={wb} />}

      <div className="mt-3">
        {view === "build_planner" && <BuildResults wb={wb} />}

        {view === "opportunities" &&
          (profit.isError ? (
            <div className="text-sm text-rose-400">
              Calculation failed: {errorMessage(profit.error)}
            </div>
          ) : profit.isPending && rows.length === 0 ? (
            <TableSkeleton />
          ) : (
            <ProfitTable
              rows={filtered}
              regionId={regionId}
              regionName={regions.data?.find((r) => r.id === regionId)?.name}
              hub={
                stationId != null
                  ? stations.find((s) => s.id === stationId)?.name
                  : undefined
              }
              onFavorite={toggleFavorite}
              onBlacklist={blacklistRow}
              onPlanBuild={(r) => {
                setView("build_planner");
                setBuildBlueprintTypeId(r.blueprintTypeId);
                setBuildSearchResult({
                  typeId: r.blueprintTypeId,
                  name: r.productName,
                });
                const ownedMeForBp = ownedMe[r.blueprintTypeId];
                const ownedTeForBp = ownedTe[r.blueprintTypeId];
                setBuildBpMe(ownedMeForBp ?? me);
                setBuildBpTe(ownedTeForBp ?? te);
                setBuildRuns(r.runs);
              }}
            />
          ))}

        {view === "favorites" && (
          <ListView
            items={favorites.data ?? []}
            rowsByType={rowsByType}
            removeLabel="Unfavorite"
            emptyTitle="No favorites yet"
            emptyHint="Star a row in the Opportunities table to track it here."
            onRemove={(id) =>
              setList.mutate({ list: "favorites", typeId: id, add: false })
            }
          />
        )}
        {view === "blacklist" && (
          <ListView
            items={blacklist.data ?? []}
            rowsByType={rowsByType}
            removeLabel="Remove"
            emptyTitle="Nothing blacklisted"
            emptyHint="Hide an item with the blacklist button in Opportunities and it’ll appear here."
            onRemove={(id) =>
              setList.mutate({ list: "blacklist", typeId: id, add: false })
            }
          />
        )}
        {view === "library" && (
          <BlueprintLibrary
            owned={owned.data ?? []}
            imported={imported}
            onImport={saveImported}
          />
        )}
      </div>

      {view === "opportunities" && isStale && (
        <StaleBar
          dirtyCount={dirtyCount}
          pending={profit.isPending}
          auto={autoRecalc}
          onToggleAuto={() => setAutoRecalc((a) => !a)}
          onRecalc={calculate}
        />
      )}
    </>
  );
}

/** Facility + stock status bar shown above the Opportunities results table.
 *  Shows what's been applied to the current pricing: region/hub, facility
 *  profiles, tax, and character stock coverage. */
function FacilityIndicator({ wb }: { wb: WorkbenchState }) {
  const {
    facilityProfiles,
    regionId,
    stationId,
    stations,
    regions,
    useStock,
    stock,
  } = wb;
  const regionName = regions.data?.find((r) => r.id === regionId)?.name ?? "";
  const stationName =
    stationId != null
      ? stations.find((s) => s.id === stationId)?.name
      : undefined;
  const approx = isApproximate(facilityProfiles);
  const stockItems = stock.data ? Object.keys(stock.data).length : 0;

  return (
    <div className="mb-3 rounded border border-zinc-800 bg-zinc-900/50 p-2 text-xs text-zinc-400">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Market:{" "}
          <span className="text-zinc-300">{stationName ?? regionName}</span>
        </span>
        <span>
          Mfg:{" "}
          <span className="text-zinc-300">
            {facilityProfileLabel(facilityProfiles.manufacturing)}
          </span>
        </span>
        <span>
          Rxn:{" "}
          <span className="text-zinc-300">
            {facilityProfileLabel(facilityProfiles.reaction)}
          </span>
        </span>
        {approx && (
          <span className="text-amber-400">
            (approximate — no live cost index)
          </span>
        )}
        {useStock && stockItems > 0 && (
          <span>
            Stock:{" "}
            <span className="text-emerald-400">{stockItems} item types</span>
          </span>
        )}
        {useStock && stockItems === 0 && (
          <span className="text-zinc-600">Stock: none found</span>
        )}
        {!useStock && (
          <span className="text-zinc-600">
            Stock: disabled (enable in Market tab)
          </span>
        )}
      </div>
    </div>
  );
}
