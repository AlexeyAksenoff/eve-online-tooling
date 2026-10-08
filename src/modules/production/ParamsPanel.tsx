import { useQuery } from "@tanstack/react-query";
import { FeesFromCharacter } from "../../components/FeesFromCharacter";
import {
  RegionSelect,
  StationSelect,
} from "../../components/RegionStationPicker";
import { CheckboxGroup, Field } from "../../components/forms";
import { BasisSelect, Num, Tabs } from "./components";
import { CostIndexField } from "./CostIndexField";
import {
  applyRigBonuses,
  exportFacilityProfiles,
  facilityProfileLabel,
  importFacilityProfiles,
  saveFacilityProfiles,
} from "./facilityProfiles";
import {
  FACILITY_STRUCTURES,
  SECURITY_TIERS,
  type FacilityProfile,
  type FacilityStructureKey,
  type SecurityTierKey,
} from "./types";
import { toggle } from "../../lib/sets";
import {
  productionManufacturingRigs,
  productionProcessingRigs,
  type RigTypeInfo,
} from "../../lib/api/production";
import { type FacilityType } from "./types";
import type { WorkbenchState } from "./workbenchTypes";

export function ParamsPanel({ wb }: { wb: WorkbenchState }) {
  const {
    tab,
    setTab,
    name,
    setName,
    ownedCount,
    ownedOnly,
    setOwnedOnly,
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
    timeSkill,
    setTimeSkill,
    facilityProfiles,
    blueprintCostPerRun,
    setBlueprintCostPerRun,
    inventionSkill,
    setInventionSkill,
        decryptorTypeId,
    setDecryptorTypeId,
    implant,
    setImplant,
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
                  onChange={(e) => setFavoritesOnly(e.currentTarget.checked)}
                />
                Favorites only
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
              <BasisSelect value={materialBasis} onChange={setMaterialBasis} />
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
              <BasisSelect value={productBasis} onChange={setProductBasis} />
              <label
                className="mt-1 flex items-center gap-1 text-xs text-zinc-300"
                title="Price each product at whichever hub pays the most (materials still priced at the chosen market). Slower — prices all hubs."
              >
                <input
                  type="checkbox"
                  checked={productBestHub}
                  onChange={(e) => setProductBestHub(e.currentTarget.checked)}
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
                  onChange={(e) => setBuildComponents(e.currentTarget.checked)}
                />
                Build sub-components
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
                  onChange={(e) => setIncludeSaleCost(e.currentTarget.checked)}
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
                Use owned blueprint ME{ownedCount > 0 ? ` (${ownedCount})` : ""}
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
                Filters Opportunities to the pasted items and flags which clear
                the min ROI below.
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
  } = wb;
  const profile = facilityProfiles[selectedProfile];

  // Apply a patch to the active profile, then recompose its rig bonuses from
  // the structure + security + selected rig type IDs. Running this on *every*
  // change (structure / security / rigs) is what fixes the stale-bonus bug
  // where switching structure or security left the old rig+structure bonus
  // in place — applyRigBonuses is only invoked here, not at each call site.
  const update = async (patches: Partial<FacilityProfile>) => {
    const next = { ...profile, ...patches } as FacilityProfile;
    const composed = await applyRigBonuses(next, next.rigTypeIds ?? []);
    setFacilityProfiles({
      ...facilityProfiles,
      [selectedProfile]: composed,
    });
  };

    const structureOptions = Object.entries(FACILITY_STRUCTURES).filter(([, s]) => {
    // "components" uses the same structures as "manufacturing" — they just get
    // a separate facility profile (cost index, rigs, tax).
    if (selectedProfile === "components") return s.facilityType === "manufacturing";
    return s.facilityType === selectedProfile;
  });

  return (
    <div className="space-y-3">
      {/* Slot switcher: Manufacturing | Reaction */}
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
          onClick={() => setSelectedProfile("reaction")}
          className={`rounded px-3 py-1.5 text-sm ${
            selectedProfile === "reaction"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Reaction
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

      {/* Security tier dropdown */}
      <Field label="Security">
        <select
          value={profile.security}
          onChange={(e) =>
            update({ security: e.target.value as SecurityTierKey })
          }
          className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none"
        >
          {Object.entries(SECURITY_TIERS).map(([key, s]) => (
            <option key={key} value={key as SecurityTierKey}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      {/* Rig selector — checkboxes from SDE-backed rig type list */}
      <Field label="Rig modules">
        <RigSelector
          facilityType={profile.facilityType}
          selectedIds={profile.rigTypeIds ?? []}
          onChange={(newIds) => {
            void update({ rigTypeIds: newIds });
          }}
        />
      </Field>

      {/* Cost index: live-fill from a build system, or a manual fraction.
          `null` = wormhole (no live index). The field auto-fills from ESI
          `/industry/systems/` like the rest of the app; tax rate has no live
          source so it stays a manual override. Cost-index changes don't affect
          rig bonuses, so set the field directly (no applyRigBonuses roundtrip). */}
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
    </Field>

    <Field label="Tax rate (fraction)">
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

                   {/* Implant/module bonuses */}
      <Field label="Implant / module bonuses">
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-zinc-400">Time −%</label>
              <Num
                value={implant?.time_bonus_pct ?? 0}
                step={0.1}
                min={0}
                max={100}
                onChange={(v) =>
                  setImplant(
                    implant
                      ? { ...implant, time_bonus_pct: v }
                      : { time_bonus_pct: v, material_bonus: 1.0, cost_bonus_pct: 0 },
                  )
                }
                placeholder="e.g. 4 (Eifyr 'Guns')"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400">ME −%</label>
              <Num
                value={(1 - (implant?.material_bonus ?? 1)) * 100}
                step={0.1}
                min={0}
                max={100}
                onChange={(v) =>
                  setImplant(
                    implant
                      ? { ...implant, material_bonus: 1 - v / 100 }
                      : { time_bonus_pct: 0, material_bonus: 1 - v / 100, cost_bonus_pct: 0 },
                  )
                }
                placeholder="e.g. 1"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400">Cost −%</label>
              <Num
                value={implant?.cost_bonus_pct ?? 0}
                step={0.1}
                min={0}
                max={100}
                onChange={(v) =>
                  setImplant(
                    implant
                      ? { ...implant, cost_bonus_pct: v }
                      : { time_bonus_pct: 0, material_bonus: 1.0, cost_bonus_pct: v },
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
                                            </div>
      </div>
    </div>
  );
}

/** Checkbox list of rig types, grouped by category (ME / TE / Cost).
 *  Fetched from the backend: `productionManufacturingRigs` for
 *  manufacturing/components facilities, `productionProcessingRigs` for
 *  reaction facilities. When a rig is toggled, `onChange` fires with
 *  the updated `typeId[]` list. */
function RigSelector({
  facilityType,
  selectedIds,
  onChange,
}: {
  facilityType: FacilityType;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const { data: rigs } = useQuery({
    queryKey: ["production", `${facilityType}-rigs`],
    queryFn:
      facilityType === "reaction"
        ? productionProcessingRigs
        : productionManufacturingRigs,
    staleTime: Infinity,
  });

  if (!rigs) {
    return <div className="text-xs text-zinc-500">Loading rigs…</div>;
  }

  const byCat: Record<string, RigTypeInfo[]> = {};
  for (const r of rigs) {
    (byCat[r.category] ??= []).push(r);
  }

  const selected = new Set(selectedIds);

  return (
    <div className="space-y-2 text-sm">
      {(["me", "te", "cost"] as const).map((cat) => {
        const items = byCat[cat];
        if (!items?.length) return null;
        const label = { me: "Material (ME)", te: "Time (TE)", cost: "Cost" }[
          cat
        ];
        return (
          <div key={cat}>
            <div className="mb-1 text-xs font-medium text-zinc-400">
              {label}
            </div>
            <div className="flex flex-wrap gap-2">
              {items.map((r) => (
                <label
                  key={r.typeId}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.typeId)}
                    onChange={(e) => {
                      const ids = e.target.checked
                        ? [...selectedIds, r.typeId]
                        : selectedIds.filter((id) => id !== r.typeId);
                      onChange(ids);
                    }}
                    className="h-3 w-3 rounded border-zinc-600 bg-zinc-800 text-indigo-600"
                  />
                  <span
                    className={
                      r.tier === "T2" ? "text-amber-300" : "text-zinc-300"
                    }
                  >
                    {r.tier}:
                  </span>
                  <span className="text-zinc-200">{r.name}</span>
                  <span className="text-zinc-500">(+{r.bonus}%)</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
