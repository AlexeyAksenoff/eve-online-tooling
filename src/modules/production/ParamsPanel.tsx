import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { FeesFromCharacter } from "../../components/FeesFromCharacter";
import {
  RegionSelect,
  StationSelect,
} from "../../components/RegionStationPicker";
import { CheckboxGroup, Field } from "../../components/forms";
import { BasisSelect, Num, Tabs } from "./components";
import { CostIndexField } from "./CostIndexField";
import { MultiCombo } from "./MultiCombo";
import { BuildWizard } from "./BuildWizard";
import { productionStationSecurity } from "../../lib/api";
import {
  applyRigBonuses,
  exportFacilityProfiles,
  facilityProfileLabel,
  importFacilityProfiles,
  saveFacilityProfiles,
} from "./facilityProfiles";
import {
  FACILITY_STRUCTURES,
  STRUCTURE_MAX_RIG_SIZE,
  SECURITY_TIERS,
  WORMHOLE_REGION_ID_START,
  securityToTier,
  type FacilityProfile,
  type FacilityProfiles,
  type FacilityStructureKey,
  type SecurityTierKey,
} from "./types";
import { toggle } from "../../lib/sets";
import type { WorkbenchState } from "./workbenchTypes";

export function ParamsPanel({ wb }: { wb: WorkbenchState }) {
  const {
    tab,
    setTab,
    view,
    name,
    setName,
    ownedCount,
    ownedOnly,
    setOwnedOnly,
    stockCompleteOnly,
    setStockCompleteOnly,
    excludeSpecialMods,
    setExcludeSpecialMods,
    favoritesOnly,
    setFavoritesOnly,
    categoryOptions,
    categories,
    setCategories,
    metaOptions,
    metas,
    setMetas,
    regions,
    regionId,
    setRegionId,
    setStationId,
    stations,
    stationId,
    materialBasis,
    setMaterialBasis,
    useStock,
    setUseStock,
    stock,
    productBasis,
    setProductBasis,
    productBestHub,
    setProductBestHub,
    buildComponents,
    setBuildComponents,
    ignoreBuildFuelBlocks,
    setIgnoreBuildFuelBlocks,
    ignoreBuildRams,
    setIgnoreBuildRams,
    includeSaleCost,
    setIncludeSaleCost,
    sellBrokerPct,
    setSellBrokerPct,
    sellTaxPct,
    setSellTaxPct,
    runs,
    setRuns,
    me,
    setMe,
    useOwnedMe,
    setUseOwnedMe,
    te,
    setTe,
    componentMe,
    setComponentMe,
    componentTe,
    setComponentTe,
    timeSkill,
    setTimeSkill,
    facilityProfiles,
    blueprintCostPerRun,
    setBlueprintCostPerRun,
    inventionSkill,
    setInventionSkill,
    decryptorTypeId,
    setDecryptorTypeId,
    decryptors,
    minRoiPct,
    setMinRoiPct,
    minVolume,
    setMinVolume,
    pasteList,
    setPasteList,
    pasteMinRoiPct,
    setPasteMinRoiPct,
  } = wb;

  return (
    <>
      {view === "build_planner" ? (
        <BuildWizard wb={wb} />
      ) : (
        <>
          <Tabs tab={tab} onChange={setTab} />

          <div className="mt-3 rounded border border-zinc-800 bg-zinc-900 p-3">
            {tab === "item" && (
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Search">
                  <input
                    value={name}
                    onChange={(e) => setName(e.currentTarget.value)}
                    placeholder="name, category, group…"
                    className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                  />
                  <label
                    className={`mt-1 flex items-center gap-1 text-xs ${
                      ownedCount > 0 ? "text-zinc-300" : "text-zinc-600"
                    }`}
                    title={
                      ownedCount > 0
                        ? "Show only items whose blueprint a logged-in character owns"
                        : "Log in a character with blueprints to enable"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={ownedOnly}
                      disabled={ownedCount === 0}
                      onChange={(e) => setOwnedOnly(e.currentTarget.checked)}
                    />
                    Owned only{ownedCount > 0 ? ` (${ownedCount})` : ""}
                  </label>
                  <label
                    className="mt-1 flex items-center gap-1 text-xs text-zinc-300"
                    title="Show only items you've favorited (★)"
                  >
                    <input
                      type="checkbox"
                      checked={favoritesOnly}
                      onChange={(e) =>
                        setFavoritesOnly(e.currentTarget.checked)
                      }
                    />
                    Favorites only
                  </label>
                  <label
                    className={`mt-1 flex items-center gap-1 text-xs ${
                      useStock ? "text-zinc-300" : "text-zinc-600"
                    }`}
                    title={
                      useStock
                        ? "Show only items whose full material cost is covered by character stock"
                        : "Enable 'Use stock' in the Market tab to inventory your warehouse"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={stockCompleteOnly}
                      disabled={!useStock}
                      onChange={(e) =>
                        setStockCompleteOnly(e.currentTarget.checked)
                      }
                    />
                    Stock-complete builds only
                  </label>
                  <label
                    className="mt-1 flex items-center gap-1 text-xs text-zinc-300"
                    title="Hide Abyssal, Faction, Storyline, Deadspace, and Officer items — LP-store/NPC-drop/mutaplasmid lines you wouldn't build to sell, even when a blueprint exists (plain Tech I/II are unaffected)"
                  >
                    <input
                      type="checkbox"
                      checked={excludeSpecialMods}
                      onChange={(e) =>
                        setExcludeSpecialMods(e.currentTarget.checked)
                      }
                    />
                    Excl. Abyssal/Faction/Storyline/Deadspace/Officer
                  </label>
                </Field>
                <Field label="Category / Type">
                  <CheckboxGroup
                    options={categoryOptions}
                    selected={categories}
                    onToggle={(v) => setCategories(toggle(categories, v))}
                    maxHeight="max-h-40"
                  />
                </Field>
                <Field label="Meta (tech level / faction)">
                  <CheckboxGroup
                    options={metaOptions}
                    selected={metas}
                    onToggle={(v) => setMetas(toggle(metas, v))}
                    maxHeight="max-h-40"
                  />
                </Field>
              </div>
            )}

            {tab === "market" && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Region">
                  <RegionSelect
                    regions={regions.data}
                    value={regionId}
                    onChange={(id) => {
                      setRegionId(id);
                      setStationId(null);
                    }}
                  />
                </Field>
                <Field label="Station">
                  <StationSelect
                    stations={stations}
                    value={stationId}
                    onChange={setStationId}
                  />
                </Field>
                <Field label="Materials priced at">
                  <BasisSelect
                    value={materialBasis}
                    onChange={setMaterialBasis}
                  />
                  <label
                    className="mt-1 flex items-center gap-1 text-xs text-zinc-300"
                    title="Net your owned assets (across the roster) against each bill of materials — you only pay for the shortfall."
                  >
                    <input
                      type="checkbox"
                      checked={useStock}
                      onChange={(e) => setUseStock(e.currentTarget.checked)}
                    />
                    Use my stock{stock.isFetching ? " (loading…)" : ""}
                  </label>
                </Field>
                <Field label="Product priced at">
                  <BasisSelect
                    value={productBasis}
                    onChange={setProductBasis}
                  />
                  <label
                    className="mt-1 flex items-center gap-1 text-xs text-zinc-300"
                    title="Price each product at whichever hub pays the most (materials still priced at the chosen market). Slower — prices all hubs."
                  >
                    <input
                      type="checkbox"
                      checked={productBestHub}
                      onChange={(e) =>
                        setProductBestHub(e.currentTarget.checked)
                      }
                    />
                    Sell at best hub
                  </label>
                </Field>
                <Field label="Components">
                  <label
                    className="flex items-center gap-1 py-1 text-xs text-zinc-300"
                    title="On: build intermediate components when cheaper than buying (recursive build-vs-buy). Off: buy every material at market."
                  >
                    <input
                      type="checkbox"
                      checked={buildComponents}
                      onChange={(e) =>
                        setBuildComponents(e.currentTarget.checked)
                      }
                    />
                    Build sub-components
                  </label>
                </Field>
                <Field label="Always buy (never build)">
                  <label
                    className="flex flex-col gap-1 py-1 text-xs text-zinc-300"
                    title="Items in these groups are always sourced from market, never built — even when building sub-components."
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ignoreBuildFuelBlocks}
                        onChange={(e) =>
                          setIgnoreBuildFuelBlocks(e.currentTarget.checked)
                        }
                      />
                      Fuel blocks (group 1136)
                    </span>
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ignoreBuildRams}
                        onChange={(e) =>
                          setIgnoreBuildRams(e.currentTarget.checked)
                        }
                      />
                      R.A.M. (group 332)
                    </span>
                  </label>
                </Field>
                <Field label="Sale costs">
                  <label
                    className="flex items-center gap-1 py-1 text-xs text-zinc-300"
                    title="Subtract broker fee + sales tax from the product sale when computing profit."
                  >
                    <input
                      type="checkbox"
                      checked={includeSaleCost}
                      onChange={(e) =>
                        setIncludeSaleCost(e.currentTarget.checked)
                      }
                    />
                    Subtract broker + tax
                  </label>
                  {includeSaleCost && (
                    <div className="mt-1 space-y-1">
                      <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                        <input
                          type="number"
                          value={sellBrokerPct}
                          min={0}
                          onChange={(e) =>
                            setSellBrokerPct(Number(e.currentTarget.value))
                          }
                          className="w-16 rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none"
                        />
                        broker %
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                        <input
                          type="number"
                          value={sellTaxPct}
                          min={0}
                          onChange={(e) =>
                            setSellTaxPct(Number(e.currentTarget.value))
                          }
                          className="w-16 rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none"
                        />
                        tax %
                      </label>
                      <FeesFromCharacter
                        onApply={(b, t) => {
                          setSellBrokerPct(b);
                          setSellTaxPct(t);
                        }}
                      />
                    </div>
                  )}
                </Field>
              </div>
            )}

            {tab === "industry" && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Num label="Runs" value={runs} onChange={setRuns} min={1} />
                <Field label={`ME (default for un-owned)`}>
                  <input
                    type="number"
                    value={me}
                    min={0}
                    max={10}
                    onChange={(e) => setMe(Number(e.currentTarget.value))}
                    className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none"
                  />
                  <label
                    className={`mt-1 flex items-center gap-1 text-xs ${
                      ownedCount > 0 ? "text-zinc-300" : "text-zinc-600"
                    }`}
                    title={
                      ownedCount > 0
                        ? "Use each owned blueprint's researched ME instead of the value above"
                        : "Log in a character with blueprints to enable"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={useOwnedMe}
                      disabled={ownedCount === 0}
                      onChange={(e) => setUseOwnedMe(e.currentTarget.checked)}
                    />
                    Use owned blueprint ME
                    {ownedCount > 0 ? ` (${ownedCount})` : ""}
                  </label>
                </Field>
                <Num
                  label="TE (default for un-owned)"
                  value={te}
                  onChange={setTe}
                  min={0}
                  max={20}
                />
                <Num
                  label="Time skills (0-5)"
                  value={timeSkill}
                  onChange={setTimeSkill}
                  min={0}
                  max={5}
                />

                {/* Build sub-components: shared ME/TE applied to ALL component build
              steps (is_component) whose blueprint isn't owned. Separate from the
                        global ME/TE above (which stays on end-products). */}
                {buildComponents && (
                  <fieldset className="mt-3 space-y-2 rounded border border-zinc-800 p-2.5">
                    <legend className="px-1 text-[11px] font-medium text-zinc-400">
                      Components ME / TE
                    </legend>
                    <Num
                      label="ME (components)"
                      value={componentMe}
                      onChange={setComponentMe}
                      min={0}
                      max={10}
                      placeholder="fallback for un-owned component BPs"
                    />
                    <Num
                      label="TE (components)"
                      value={componentTe}
                      onChange={setComponentTe}
                      min={0}
                      max={20}
                      placeholder="fallback for un-owned component BPs"
                    />
                  </fieldset>
                )}

                {/* Facility profile preview (configured in the Facilities tab) */}
                <Field label="Manufacturing facility">
                  <div className="text-sm text-zinc-300">
                    {facilityProfileLabel(facilityProfiles.manufacturing)}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Configure structure, rigs, cost index, and tax in the
                    <button
                      onClick={() => setTab("facilities")}
                      className="ml-1 underline hover:text-zinc-300"
                    >
                      Facilities tab
                    </button>
                    .
                  </div>
                </Field>

                <Num
                  label="Blueprint cost / run"
                  value={blueprintCostPerRun}
                  onChange={setBlueprintCostPerRun}
                  min={0}
                  step={1000000}
                />
                <Num
                  label="Invention skills (0-5)"
                  value={inventionSkill}
                  onChange={setInventionSkill}
                  min={0}
                  max={5}
                />
                <Field label="Decryptor (T2 invention)">
                  <select
                    value={decryptorTypeId ?? ""}
                    onChange={(e) =>
                      setDecryptorTypeId(
                        e.currentTarget.value === ""
                          ? null
                          : Number(e.currentTarget.value),
                      )
                    }
                    className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none"
                  >
                    <option value="">None</option>
                    {decryptors.data?.map((d) => (
                      <option key={d.typeId} value={d.typeId}>
                        {d.name.replace(/ Decryptor$/, "")} (ME{" "}
                        {d.meModifier >= 0 ? "+" : ""}
                        {d.meModifier}, runs {d.runModifier >= 0 ? "+" : ""}
                        {d.runModifier}, ×{d.probabilityMultiplier} prob)
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}

            {tab === "thresholds" && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Min ROI %">
                  <input
                    type="number"
                    value={minRoiPct}
                    min={0}
                    onChange={(e) => setMinRoiPct(e.currentTarget.value)}
                    placeholder="0"
                    className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                  />
                </Field>
                <Field label="Min volume">
                  <input
                    type="number"
                    value={minVolume}
                    min={0}
                    disabled={stationId === null}
                    onChange={(e) => setMinVolume(e.currentTarget.value)}
                    placeholder={stationId === null ? "pick a market hub" : "0"}
                    className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:opacity-50"
                  />
                </Field>
              </div>
            )}

            {tab === "paste" && (
              <div className="grid gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                  <Field label="Paste items (names, EVE Multibuy, inventory dump)">
                    <textarea
                      value={pasteList}
                      onChange={(e) => setPasteList(e.currentTarget.value)}
                      rows={6}
                      placeholder={"Rifter\nWarrior II\n…"}
                      className="w-full rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-100 outline-none placeholder:text-zinc-500"
                    />
                  </Field>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Filters Opportunities to the pasted items and flags which
                    clear the min ROI below.
                  </p>
                </div>
                <Field label="Min ROI % to count as worth selling">
                  <input
                    type="number"
                    value={pasteMinRoiPct}
                    min={0}
                    onChange={(e) => setPasteMinRoiPct(e.currentTarget.value)}
                    placeholder="0"
                    className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                  />
                </Field>
              </div>
            )}

            {tab === "facilities" && <FacilityProfilePanel wb={wb} />}
          </div>
        </>
      )}
    </>
  );
}

/** Panel for configuring the two facility profile slots (Manufacturing +
 *  Reaction). See `FacilityProfile` type for field meanings. */
function FacilityProfilePanel({ wb }: { wb: WorkbenchState }) {
  const {
    facilityProfiles,
    setFacilityProfiles,
    selectedProfile,
    setSelectedProfile,
    implant,
    setImplant,
    stationId,
    regionId,
  } = wb;
  const profile = facilityProfiles[selectedProfile];

  // Auto-derive the system's security tier from the selected station + region,
  // instead of trusting a hand-picked dropdown. The tier only moves T2 rig
  // bonuses — structure/te/cost base-bonuses are structure-driven, not
  // security-driven. Security tier is the same for all three facility profiles
  // (they share one solar-system context).
  const stationSecurity = useQuery({
    queryKey: ["production", "station_security", stationId],
    queryFn: () =>
      stationId ? productionStationSecurity(stationId) : Promise.resolve(null),
    enabled: !!stationId,
  });

  // WH systems can't be represented by a security float (they're ~0.0, same as
  // nullsec), so detect them via region ID. Otherwise derive the tier from the
  // float: >=0.5 highsec, >0 lowsec, <=0 nullsec.
  const effectiveSecurityTier = useMemo<SecurityTierKey>(() => {
    if (stationSecurity.data !== null && stationSecurity.data !== undefined) {
      return securityToTier(stationSecurity.data, regionId);
    }
    if (regionId >= WORMHOLE_REGION_ID_START) return "wormhole";
    return "highsec";
  }, [stationSecurity.data, regionId]);

  // Sync the auto-derived tier across all three facility profiles and recompute
  // each profile's rig bonuses (T2 rigs scale by security tier). Runs only when
  // the tier changes — stable tiers are a no-op via the early `continue`.
  useEffect(() => {
    const profileKeys: ReadonlyArray<keyof FacilityProfiles> = [
      "manufacturing",
      "components",
      "reaction",
    ];
    for (const key of profileKeys) {
      const current = facilityProfiles[key];
      if (current.security === effectiveSecurityTier) continue;
      // Optimistically write the new tier on all slots...
      setFacilityProfiles((prev) => ({
        ...prev,
        [key]: { ...prev[key], security: effectiveSecurityTier },
      }));
      // ...then recompute rig bonuses against the new tier (async). Functional
      // update folds in any newer edits another tab may have written meanwhile.
      void applyRigBonuses(
        { ...current, security: effectiveSecurityTier },
        current.rigTypeIds ?? [],
      ).then((composed) => {
        setFacilityProfiles((prev) => ({
          ...prev,
          [key]: {
            ...prev[key],
            meBonus: composed.meBonus,
            teBonusPct: composed.teBonusPct,
            costBonus: composed.costBonus,
          },
        }));
      });
    }
  }, [effectiveSecurityTier, facilityProfiles, setFacilityProfiles]);

  // Apply a patch to the active profile, then recompose its rig bonuses from
  // the structure + security + selected rig type IDs. Running this on *every*
  // change (structure / security / rigs) is what fixes the stale-bonus bug
  // where switching structure or security left the old rig+structure bonus in
  // place — applyRigBonuses is only invoked here, not at each call site.
  //
  // CRITICAL: both writes use FUNCTIONAL updates (prev => …) so we never read
  // a stale `facilityProfiles` closure. The previous version captured
  // `facilityProfiles` from the render in which `update` was created, then
  // wrote it back from a `.then()` — by the time the promise resolved, another
  // tab's edits had landed in state, and the awaiter silently OVERWROTE them.
  // That was the root cause of (a) the build-system index "drifting" between
  // tabs and (b) rig selections / tax edits "not saving". Functional updates
  // always fold into the *latest* committed state.
  const update = (patches: Partial<FacilityProfile>) => {
    // 1) Optimistically persist the structural patch (structure / security /
    //    rigs / tax) so the UI reflects the edit instantly, without waiting
    //    for the async rig-bonus RPC.
    setFacilityProfiles((prev) => ({
      ...prev,
      [selectedProfile]: { ...prev[selectedProfile], ...patches },
    }));
    // 2) Recompose rig bonuses (async) and OVERLAY only the bonus fields —
    //    never clobber a newer edit another tab may have written in the gap.
    void applyRigBonuses(
      { ...facilityProfiles[selectedProfile], ...patches },
      patches.rigTypeIds ?? facilityProfiles[selectedProfile].rigTypeIds ?? [],
    ).then((composed) => {
      setFacilityProfiles((prev) => ({
        ...prev,
        [selectedProfile]: {
          ...prev[selectedProfile],
          // keep any edits written since step 1, only overwrite bonuses:
          meBonus: composed.meBonus,
          teBonusPct: composed.teBonusPct,
          costBonus: composed.costBonus,
          rigTypeIds: composed.rigTypeIds,
        },
      }));
    });
  };

  const structureOptions = Object.entries(FACILITY_STRUCTURES).filter(
    ([, s]) => {
      // "components" uses the same structures as "manufacturing" — they just get
      // a separate facility profile (cost index, rigs, tax).
      if (selectedProfile === "components")
        return s.facilityType === "manufacturing";
      return s.facilityType === selectedProfile;
    },
  );

  return (
    <div className="space-y-3">
      {/* Slot switcher: Manufacturing | Components | Reaction */}
      <div className="flex gap-2">
        <button
          onClick={() => setSelectedProfile("manufacturing")}
          className={`rounded px-3 py-1.5 text-sm ${
            selectedProfile === "manufacturing"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Manufacturing
        </button>
        <button
          onClick={() => setSelectedProfile("components")}
          className={`rounded px-3 py-1.5 text-sm ${
            selectedProfile === "components"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Components
        </button>
        <button
          onClick={() => setSelectedProfile("reaction")}
          className={`rounded px-3 py-1.5 text-sm ${
            selectedProfile === "reaction"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Reaction
        </button>
      </div>

      {/* Profile label */}
      <div className="text-xs text-zinc-500">
        Active: {facilityProfileLabel(profile)}
        {profile.systemCostIndex === null && (
          <span className="ml-2 text-amber-400">
            (approximate — no live cost index)
          </span>
        )}
      </div>

      {/* Structure dropdown */}
      <Field label="Structure">
        <select
          value={profile.structure}
          onChange={(e) =>
            update({ structure: e.target.value as FacilityStructureKey })
          }
          className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none"
        >
          {structureOptions.map(([key, s]) => (
            <option key={key} value={key}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      {/* Security tier — auto-derived from the selected station's system,
       * NOT user-editable. T2 rig bonuses scale by security tier. */}
      <Field
        label="Security"
        title={
          stationSecurity.isPending
            ? "Deriving security tier from the selected station…"
            : SECURITY_TIERS[effectiveSecurityTier].hasNoLiveCostIndex
              ? "Wormhole systems have no live ESI cost index — system cost index is a manual override"
              : "Auto-derived from the selected station's solar system"
        }
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-200">
            {SECURITY_TIERS[effectiveSecurityTier].label}
            {stationSecurity.isPending && (
              <span className="ml-1 animate-spin text-xs">○</span>
            )}
          </span>
          {SECURITY_TIERS[effectiveSecurityTier].hasNoLiveCostIndex && (
            <span
              className="text-xs text-amber-400"
              title="No live ESI cost index for this system — system cost index is a manual override"
            >
              (manual cost index)
            </span>
          )}
        </div>
      </Field>

      {/* Rig selector — SDE-backed multiselect. Only rigs whose slot size
       * exactly matches the chosen structure's rig slot are offered
       * (rig.rigSize == maxRigSize), so e.g. an L‑set won't show on an
       * Athanor. Selecting toggles the profile's rigTypeIds; `update` runs
       * applyRigBonuses → production_rig_bonuses to recompute ME/TE/cost. */}
      <Field label="Rig modules">
        <MultiCombo
          facilityType={profile.facilityType}
          maxRigSize={STRUCTURE_MAX_RIG_SIZE[profile.structure]}
          selectedIds={profile.rigTypeIds ?? []}
          onChange={(newIds) => {
            void update({ rigTypeIds: newIds });
          }}
        />
      </Field>

      {/* Tax rate (facility/structure tax, 0–1 fraction, manual override).
          The 4% CCP SCC surcharge on job fees is applied separately in the
          engine (scc_surcharge) — do NOT enter it here. */}
      <Field
        label="Tax rate (fraction, 0–1)"
        title="Facility/structure tax rate as a 0–1 fraction, applied to the job fee (EIV × tax). The 4% CCP SCC surcharge is added separately by the engine — do not enter it here. 0.00 for a player-owned structure (tax set by the corp)."
      >
        <input
          type="number"
          value={profile.taxRate ?? ""}
          onChange={(e) =>
            setFacilityProfiles({
              ...facilityProfiles,
              [selectedProfile]: {
                ...profile,
                taxRate: e.target.value ? Number(e.target.value) : null,
              },
            })
          }
          step={0.01}
          min={0}
          max={1}
          placeholder="0–1 (e.g. 0.00 / player HQ)"
          className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
      </Field>

      {/* Cost index: live-fill from a build system, or a manual fraction.
          `null` = wormhole (no live index). The field auto-fills from ESI
          `/industry/systems/` like the rest of the app. Each facility type
          keeps its OWN system cost index, so a reaction facility can sit in a
          different system from the manufacturing one. The label + tooltip come
          from CostIndexField itself, so we don't wrap it in another <Field>. */}
      <CostIndexField
        value={profile.systemCostIndex}
        onChange={(ci) =>
          setFacilityProfiles({
            ...facilityProfiles,
            [selectedProfile]: { ...profile, systemCostIndex: ci },
          })
        }
        systemId={profile.systemId}
        onSystemChange={(id) =>
          setFacilityProfiles({
            ...facilityProfiles,
            [selectedProfile]: { ...profile, systemId: id },
          })
        }
      />

      {/* Implant/module bonuses */}
      <Field
        label="Implant / module bonuses"
        title="Per-character bonuses (implants like Eifyr 'Guns', industry cores), applied ON TOP of facility+rig bonuses — ME is multiplicative with facility ME, TE/Cost additive. Does NOT duplicate rig bonuses: rigs = facility level, this = character level."
      >
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-zinc-400">Time −%</label>
              <Num
                value={implant?.timeBonusPct ?? 0}
                step={0.1}
                min={0}
                max={100}
                onChange={(v) =>
                  setImplant(
                    implant
                      ? { ...implant, timeBonusPct: v }
                      : {
                          timeBonusPct: v,
                          materialBonus: 1.0,
                          costBonusPct: 0,
                        },
                  )
                }
                placeholder="e.g. 4 (Eifyr 'Guns')"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400">ME −%</label>
              <Num
                value={(1 - (implant?.materialBonus ?? 1)) * 100}
                step={0.1}
                min={0}
                max={100}
                onChange={(v) =>
                  setImplant(
                    implant
                      ? { ...implant, materialBonus: 1 - v / 100 }
                      : {
                          timeBonusPct: 0,
                          materialBonus: 1 - v / 100,
                          costBonusPct: 0,
                        },
                  )
                }
                placeholder="e.g. 1"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400">Cost −%</label>
              <Num
                value={implant?.costBonusPct ?? 0}
                step={0.1}
                min={0}
                max={100}
                onChange={(v) =>
                  setImplant(
                    implant
                      ? { ...implant, costBonusPct: v }
                      : {
                          timeBonusPct: 0,
                          materialBonus: 1.0,
                          costBonusPct: v,
                        },
                  )
                }
                placeholder="e.g. 2"
              />
            </div>
          </div>
          {implant && (
            <button
              onClick={() => setImplant(null)}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline"
            >
              Clear implant bonuses
            </button>
          )}
        </div>
      </Field>

      {/* JSON import / export */}
      <div className="flex gap-2 pt-2 border-t border-zinc-800">
        <button
          onClick={() => {
            const json = exportFacilityProfiles(facilityProfiles);
            navigator.clipboard.writeText(json).then(() => {
              // Visual feedback could be added here
              console.log("Facility profiles copied to clipboard");
            });
          }}
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Export JSON
        </button>
        <label className="relative cursor-pointer rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
          Import JSON
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              const restored = importFacilityProfiles(text);
              setFacilityProfiles(restored);
              saveFacilityProfiles(restored);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}
