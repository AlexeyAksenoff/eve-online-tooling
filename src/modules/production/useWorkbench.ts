import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ownedBlueprints,
  productionDecryptors,
  productionProfit,
  productionProfitForBlueprint,
  rosterStock,
  sdeUpdate,
  type ImplantBonus,
  type PriceBasis,
  type ProfitBreakdown,
  type ProfitParams,
} from "../../lib/api";
import { marketKeys } from "../../lib/queryKeys";
import { useTypeIdLists } from "../../lib/useSavedLists";
import { classifyPaste, dedupNames, isExcludedMetaGroup } from "./helpers";
import {
  bestResearchedMap,
  composeProfitParams,
  countDirtySettings,
} from "./profitParams";
import { toggle, uniqueSorted } from "../../lib/sets";
import { parseItems } from "../../lib/parseItems";
import {
  FORGE,
  FUEL_BLOCK_GROUP_ID,
  IMPORTED_BP_KEY,
  RAM_GROUP_ID,
  loadImported,
  type ImportedBlueprint,
  type ResultsView,
  type Tab,
} from "./types";
import type { BlueprintSearchResult } from "../../lib/api";
import {
  loadFacilityProfiles,
  saveFacilityProfiles,
  type FacilityProfiles,
} from "./facilityProfiles";
import type { ActiveFilter, WorkbenchState } from "./workbenchTypes";

export function useWorkbench(): WorkbenchState {
  const [tab, setTab] = useState<Tab>("market");
  const [view, setView] = useState<ResultsView>("opportunities");

  // Pricing/cost params — changing these re-runs the calculation.
  const [regionId, setRegionId] = useState(FORGE);
  const [stationId, setStationId] = useState<number | null>(null);
  const [runs, setRuns] = useState(1);
  const [me, setMe] = useState(0);
  const [useOwnedMe, setUseOwnedMe] = useState(true);
  const [useStock, setUseStock] = useState(false);
  const [buildComponents, setBuildComponents] = useState(false);
  const [ignoreBuildFuelBlocks, setIgnoreBuildFuelBlocks] = useState(false);
  const [ignoreBuildRams, setIgnoreBuildRams] = useState(false);
  const [te, setTe] = useState(0);
  // Fallback ME/TE applied to ALL component build steps (is_component) when the
  // component's blueprint is not owned — one pair for all components.
  const [componentMe, setComponentMe] = useState(0);
  const [componentTe, setComponentTe] = useState(0);
  const [timeSkill, setTimeSkill] = useState(5);

  // Facility profiles (Manufacturing + Reaction). Loaded from localStorage,
  // persisted on change. Edited in the Facilities tab.
  const [facilityProfiles, setFacilityProfiles] = useState<FacilityProfiles>(
    () => loadFacilityProfiles(),
  );
  useEffect(() => {
    saveFacilityProfiles(facilityProfiles);
  }, [facilityProfiles]);
  const [selectedProfile, setSelectedProfile] = useState<
    "manufacturing" | "reaction" | "components"
  >("manufacturing");

  // Sale costs on the product: broker fee + sales tax, subtracted from revenue.
  const [includeSaleCost, setIncludeSaleCost] = useState(false);
  const [sellBrokerPct, setSellBrokerPct] = useState(3);
  const [sellTaxPct, setSellTaxPct] = useState(4.5);
  const [materialBasis, setMaterialBasis] =
    useState<PriceBasis>("sellPercentile");
  const [productBasis, setProductBasis] =
    useState<PriceBasis>("sellPercentile");
  const [productBestHub, setProductBestHub] = useState(false);
  const [blueprintCostPerRun, setBlueprintCostPerRun] = useState(0);
  const [inventionSkill, setInventionSkill] = useState(5);
  const [decryptorTypeId, setDecryptorTypeId] = useState<number | null>(null);
  // Implant/module bonuses (e.g. Eifyr 'Guns'): additional time/ME/cost reduction.
  const [implant, setImplant] = useState<ImplantBonus | null>(null);

  // Build Planner state: a specific blueprint selected for single-BP planning.
  const [buildBlueprintTypeId, setBuildBlueprintTypeId] = useState<
    number | null
  >(null);
  const [buildBpMe, setBuildBpMe] = useState(0);
  const [buildBpTe, setBuildBpTe] = useState(0);
  const [buildRuns, setBuildRuns] = useState(1);
  const [buildSearchResult, setBuildSearchResult] =
    useState<BlueprintSearchResult | null>(null);

  // Client-side filters — applied instantly to the results.
  const [name, setName] = useState("");
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [metas, setMetas] = useState<Set<string>>(new Set());
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [excludeSpecialMods, setExcludeSpecialMods] = useState(false);
  const [stockCompleteOnly, setStockCompleteOnly] = useState(false);

  const [minRoiPct, setMinRoiPct] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [pasteList, setPasteList] = useState("");
  const [pasteMinRoiPct, setPasteMinRoiPct] = useState("20");

  const regions = useQuery(marketKeys.regions());
  const owned = useQuery({
    queryKey: ["owned", "blueprints"],
    queryFn: ownedBlueprints,
  });
  const decryptors = useQuery({
    queryKey: ["production", "decryptors"],
    queryFn: productionDecryptors,
  });
  const stock = useQuery({
    queryKey: ["roster", "stock"],
    queryFn: rosterStock,
    enabled: useStock,
  });
  const ownedSet = useMemo(
    () => new Set(owned.data?.map((b) => b.typeId)),
    [owned.data],
  );
  const ownedCount = ownedSet.size;
  const [imported, setImported] = useState<ImportedBlueprint[]>(loadImported);
  function saveImported(next: ImportedBlueprint[]) {
    setImported(next);
    try {
      localStorage.setItem(IMPORTED_BP_KEY, JSON.stringify(next));
    } catch {
      // storage may be unavailable; the overlay still works in-memory
    }
  }

  // Best researched ME/TE per blueprint type (highest across owned copies, then
  // imported entries layered on so you can model BPs you don't own yet).
  const ownedMe = useMemo(
    () =>
      bestResearchedMap(owned.data ?? [], imported, "materialEfficiency", "me"),
    [owned.data, imported],
  );
  const ownedTe = useMemo(
    () => bestResearchedMap(owned.data ?? [], imported, "timeEfficiency", "te"),
    [owned.data, imported],
  );
  const update = useMutation({ mutationFn: () => sdeUpdate(false) });
  const [rows, setRows] = useState<ProfitBreakdown[]>([]);
  const profit = useMutation({
    mutationFn: (p: ProfitParams) => productionProfit(p),
    onSuccess: setRows,
  });

  // Build Planner: score a single blueprint instead of the whole catalogue.
  const buildProfit = useMutation({
    mutationFn: (params: ProfitParams) =>
      buildBlueprintTypeId != null
        ? productionProfitForBlueprint(buildBlueprintTypeId, params)
        : Promise.reject(new Error("No blueprint selected")),
  });

  const { favorites, blacklist, setList, toggleFavorite, blacklistRow } =
    useTypeIdLists("production", setRows, (r) => r.blueprintTypeId);

  // The pricing/cost settings that actually drive a re-price (the client-side
  // filters are excluded — they apply instantly). A change to any of these
  // makes the current results table stale until the next Calculate.
  const settings = {
    regionId,
    stationId,
    runs,
    me,
    useOwnedMe,
    ownedMe,
    ownedTe,
    useStock,
    buildComponents,
    ignoreBuildFuelBlocks,
    te,
    componentMe,
    componentTe,
    timeSkill,
    includeSaleCost,
    sellBrokerPct,
    sellTaxPct,
    materialBasis,
    productBasis,
    productBestHub,
    blueprintCostPerRun,
    inventionSkill,
    decryptorTypeId,
    facilityProfiles,
    implant,
  };
  // Snapshot of `settings` as of the last calculate, to detect staleness.
  const [calcSettings, setCalcSettings] = useState(settings);
  const dirtyCount = countDirtySettings(settings, calcSettings);
  const isStale = dirtyCount > 0 && rows.length > 0;

  function calculate() {
    setCalcSettings(settings);
    profit.mutate(
      composeProfitParams({
        regionId,
        stationId,
        runs,
        me,
        useOwnedMe,
        ownedMe,
        te,
        ownedTe,
        timeSkill,
        useStock,
        stock: stock.data,
        buildComponents,
        ignoreBuildGroups: [
          ...(ignoreBuildFuelBlocks ? [FUEL_BLOCK_GROUP_ID] : []),
          ...(ignoreBuildRams ? [RAM_GROUP_ID] : []),
        ],
        includeSaleCost,
        sellTaxPct,
        sellBrokerPct,
        materialBasis,
        productBasis,
        blueprintCostPerRun,
        inventionSkill,
        decryptorTypeId,
        productBestHub,
        facilityProfiles,
        ignoreSideProducts: true,
        implant,
        componentMe,
        componentTe,
      }),
    );
  }

  // Build Planner: price a single blueprint with per-BP ME/TE/runs overrides.
  function calculateBuild() {
    if (buildBlueprintTypeId == null) return;
    // Merge the wizard's per-BP ME/TE into owned_me/owned_te so they
    // override the global fallback for this specific blueprint.
    const buildOwnedMe = { ...ownedMe, [buildBlueprintTypeId]: buildBpMe };
    const buildOwnedTe = { ...ownedTe, [buildBlueprintTypeId]: buildBpTe };
    buildProfit.mutate(
      composeProfitParams({
        regionId,
        stationId,
        runs: buildRuns,
        me,
        useOwnedMe: true, // honor the per-BP ME we just set above
        ownedMe: buildOwnedMe,
        te,
        ownedTe: buildOwnedTe,
        timeSkill,
        useStock,
        stock: stock.data,
        buildComponents,
        ignoreBuildGroups: [
          ...(ignoreBuildFuelBlocks ? [FUEL_BLOCK_GROUP_ID] : []),
          ...(ignoreBuildRams ? [RAM_GROUP_ID] : []),
        ],
        includeSaleCost,
        sellTaxPct,
        sellBrokerPct,
        materialBasis,
        productBasis,
        blueprintCostPerRun,
        inventionSkill,
        decryptorTypeId,
        productBestHub,
        facilityProfiles,
        ignoreSideProducts: true,
        implant,
        componentMe,
        componentTe,
      }),
    );
  }

  // Optional debounced auto-recalc: when on, a settings change re-prices itself
  // after a short pause instead of waiting for a manual Calculate.
  const [autoRecalc, setAutoRecalc] = useState(false);
  const calcRef = useRef(calculate);
  calcRef.current = calculate;
  useEffect(() => {
    if (!autoRecalc || !isStale) return;
    const t = setTimeout(() => calcRef.current(), 600);
    return () => clearTimeout(t);
  }, [autoRecalc, isStale, dirtyCount]);

  // Rank once on first load.
  useEffect(() => {
    calculate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoryOptions = useMemo(
    () => uniqueSorted(rows, (r) => r.category),
    [rows],
  );
  const metaOptions = useMemo(
    () => uniqueSorted(rows, (r) => r.metaGroup),
    [rows],
  );

  // "Paste list" filter — parse pasted item names (reusing the shopping paste
  // parser), dedup (keeping original casing), then classify against the full
  // priced set for the build-and-sell verdict.
  const pastedItems = useMemo(
    () => dedupNames(parseItems(pasteList)),
    [pasteList],
  );
  const pastedNames = useMemo(
    () => new Set(pastedItems.map((n) => n.toLowerCase())),
    [pastedItems],
  );
  const pasteMinRoi =
    pasteMinRoiPct.trim() === "" ? 0 : Number(pasteMinRoiPct) / 100;
  const pasteVerdict = useMemo(
    () =>
      pastedItems.length === 0
        ? null
        : classifyPaste(pastedItems, rows, pasteMinRoi),
    [pastedItems, rows, pasteMinRoi],
  );

  const filtered = useMemo(() => {
    const needle = name.trim().toLowerCase();
    const minRoi = minRoiPct.trim() === "" ? null : Number(minRoiPct) / 100;
    const minVol =
      stationId === null || minVolume.trim() === "" ? null : Number(minVolume);
    return rows.filter((r) => {
      if (pastedNames.size > 0 && !pastedNames.has(r.productName.toLowerCase()))
        return false;
      if (
        needle &&
        ![r.productName, r.category, r.group, r.metaGroup]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
        return false;
      if (categories.size > 0 && !(r.category && categories.has(r.category)))
        return false;
      if (metas.size > 0 && !(r.metaGroup && metas.has(r.metaGroup)))
        return false;
      if (ownedOnly && !ownedSet.has(r.blueprintTypeId)) return false;
      if (stockCompleteOnly && !stockCoversRow(r)) return false;
      if (excludeSpecialMods && isExcludedMetaGroup(r.metaGroup)) return false;
      if (favoritesOnly && !r.favorite) return false;
      if (minRoi !== null && (r.roi ?? -Infinity) < minRoi) return false;
      if (minVol !== null && (r.productVolume ?? 0) < minVol) return false;
      return true;
    });
  }, [
    rows,
    name,
    categories,
    metas,
    ownedOnly,
    stockCompleteOnly,
    excludeSpecialMods,
    favoritesOnly,
    ownedSet,
    minRoiPct,
    minVolume,
    stationId,
    pastedNames,
  ]);

  const stations = regions.data?.find((r) => r.id === regionId)?.stations ?? [];
  const rowsByType = useMemo(
    () => new Map(rows.map((r) => [r.blueprintTypeId, r])),
    [rows],
  );

  // Every active client-side filter as a removable chip, so what's constraining
  // the ranking is visible above the table rather than buried across four tabs.
  const activeFilters: ActiveFilter[] = [];
  if (name.trim())
    activeFilters.push({
      key: "name",
      label: `“${name.trim()}”`,
      clear: () => setName(""),
    });
  for (const c of categories)
    activeFilters.push({
      key: `cat:${c}`,
      label: c,
      clear: () => setCategories(toggle(categories, c)),
    });
  for (const m of metas)
    activeFilters.push({
      key: `meta:${m}`,
      label: m,
      clear: () => setMetas(toggle(metas, m)),
    });
  if (stockCompleteOnly)
    activeFilters.push({
      key: "stock",
      label: "Stock-complete builds only",
      clear: () => setStockCompleteOnly(false),
    });
  if (ownedOnly)
    activeFilters.push({
      key: "owned",
      label: "Owned only",
      clear: () => setOwnedOnly(false),
    });
  if (excludeSpecialMods)
    activeFilters.push({
      key: "special",
      label: "Excl. Abyssal/Faction/Storyline/Deadspace/Officer",
      clear: () => setExcludeSpecialMods(false),
    });
  if (favoritesOnly)
    activeFilters.push({
      key: "fav",
      label: "Favorites only",
      clear: () => setFavoritesOnly(false),
    });
  if (minRoiPct.trim())
    activeFilters.push({
      key: "roi",
      label: `ROI ≥ ${minRoiPct}%`,
      clear: () => setMinRoiPct(""),
    });
  if (minVolume.trim() && stationId !== null)
    activeFilters.push({
      key: "vol",
      label: `Volume ≥ ${minVolume}`,
      clear: () => setMinVolume(""),
    });
  if (pastedNames.size > 0)
    activeFilters.push({
      key: "paste",
      label: `Pasted list (${pastedNames.size})`,
      clear: () => setPasteList(""),
    });
  function resetAllFilters() {
    setName("");
    setCategories(new Set());
    setMetas(new Set());
    setOwnedOnly(false);
    setStockCompleteOnly(false);
    setExcludeSpecialMods(false);
    setFavoritesOnly(false);
    setMinRoiPct("");
    setMinVolume("");
    setPasteList("");
  }

  // For the "stock-complete builds only" filter: true when every material is
  // either built (cheaper than buying) or covered by owned stock.
  function stockCoversRow(r: ProfitBreakdown): boolean {
    return r.materials.every((m) => m.built || m.have >= m.requiredQuantity);
  }

  return {
    tab,
    setTab,
    view,
    setView,
    regionId,
    setRegionId,
    stationId,
    setStationId,
    runs,
    setRuns,
    me,
    setMe,
    useOwnedMe,
    setUseOwnedMe,
    useStock,
    setUseStock,
    buildComponents,
    setBuildComponents,
    ignoreBuildFuelBlocks,
    setIgnoreBuildFuelBlocks,
    ignoreBuildRams,
    setIgnoreBuildRams,
    te,
    setTe,
    componentMe,
    setComponentMe,
    componentTe,
    setComponentTe,
    timeSkill,
    setTimeSkill,
    includeSaleCost,
    setIncludeSaleCost,
    sellBrokerPct,
    setSellBrokerPct,
    sellTaxPct,
    setSellTaxPct,
    materialBasis,
    setMaterialBasis,
    productBasis,
    setProductBasis,
    productBestHub,
    setProductBestHub,
    blueprintCostPerRun,
    setBlueprintCostPerRun,
    inventionSkill,
    setInventionSkill,
    decryptorTypeId,
    setDecryptorTypeId,
    implant,
    setImplant,
    facilityProfiles,
    setFacilityProfiles,
    selectedProfile,
    setSelectedProfile,
    name,
    setName,
    categories,
    setCategories,
    metas,
    setMetas,
    ownedOnly,
    setOwnedOnly,
    stockCompleteOnly,
    setStockCompleteOnly,
    excludeSpecialMods,
    setExcludeSpecialMods,
    favoritesOnly,
    setFavoritesOnly,
    minRoiPct,
    setMinRoiPct,
    minVolume,
    setMinVolume,
    pasteList,
    setPasteList,
    pasteMinRoiPct,
    setPasteMinRoiPct,
    regions,
    owned,
    decryptors,
    stock,
    favorites,
    blacklist,
    update,
    profit,
    ownedSet,
    ownedCount,
    ownedMe,
    ownedTe,
    rows,
    setRows,
    categoryOptions,
    metaOptions,
    pastedItems,
    pastedNames,
    pasteMinRoi,
    pasteVerdict,
    filtered,
    stations,
    rowsByType,
    activeFilters,
    isStale,
    dirtyCount,
    imported,
    saveImported,
    toggleFavorite,
    blacklistRow,
    calculate,
    calculateBuild,
    resetAllFilters,
    setList,
    autoRecalc,
    setAutoRecalc,
    buildBlueprintTypeId,
    setBuildBlueprintTypeId,
    buildBpMe,
    setBuildBpMe,
    buildBpTe,
    setBuildBpTe,
    buildRuns,
    setBuildRuns,
    buildSearchResult,
    setBuildSearchResult,
    buildProfit,
  };
}
