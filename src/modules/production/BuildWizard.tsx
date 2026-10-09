import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import {
  RegionSelect,
  StationSelect,
} from "../../components/RegionStationPicker";
import { Field } from "../../components/forms";
import { BasisSelect, Num } from "./components";
import { CostIndexField } from "./CostIndexField";
import { MultiCombo } from "./MultiCombo";
import {
  productionSearchBlueprints,
  type BlueprintSearchResult,
  type ImplantBonus,
  type PriceBasis,
} from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { applyRigBonuses } from "./facilityProfiles";
import {
  FACILITY_STRUCTURES,
  STRUCTURE_MAX_RIG_SIZE,
  type FacilityProfile,
  type FacilityStructureKey,
} from "./types";
import type { WorkbenchState } from "./workbenchTypes";

const STEPS = ["Blueprint", "Facility", "Options", "Results"] as const;
type Step = (typeof STEPS)[number];

export function BuildWizard({ wb }: { wb: WorkbenchState }) {
  const {
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
    calculateBuild,
    regionId,
    setRegionId,
    stationId,
    setStationId,
    me,
    ownedMe,
    ownedTe,
    te,
    componentMe,
    setComponentMe,
    componentTe,
    setComponentTe,
    timeSkill,
    setTimeSkill,
    buildComponents,
    setBuildComponents,
    ignoreBuildFuelBlocks,
    setIgnoreBuildFuelBlocks,
    ignoreBuildRams,
    setIgnoreBuildRams,
    useStock,
    setUseStock,
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
    decryptors,
    implant,
    setImplant,
    facilityProfiles,
    setFacilityProfiles,
    selectedProfile,
    setSelectedProfile,
    regions,
    stations,
  } = wb;

  const [step, setStep] = useState<Step>("Blueprint");
  const [bpSearch, setBpSearch] = useState("");
  const debouncedSearch = useDebouncedValue(bpSearch, 200);
  const stepIdx = STEPS.indexOf(step);
  const canNext = stepIdx < STEPS.length - 1;

  const { data: searchResults = [] } = useQuery({
    queryKey: ["production", "blueprintSearch", debouncedSearch],
    queryFn: () =>
      debouncedSearch.trim()
        ? productionSearchBlueprints(debouncedSearch.trim(), 20)
        : Promise.resolve([]),
    staleTime: 5 * 1000,
    enabled: debouncedSearch.length > 0,
  });

  const ownedMeForBp = buildBlueprintTypeId
    ? ownedMe[buildBlueprintTypeId]
    : undefined;
  const ownedTeForBp = buildBlueprintTypeId
    ? ownedTe[buildBlueprintTypeId]
    : undefined;

  const profile = facilityProfiles[selectedProfile];
  const maxRigSize = STRUCTURE_MAX_RIG_SIZE[profile.structure];
  const structureOptions = Object.entries(FACILITY_STRUCTURES).filter(
    ([, s]) => {
      if (selectedProfile === "components")
        return s.facilityType === "manufacturing";
      return s.facilityType === selectedProfile;
    },
  );

  function updateProfile(patches: Partial<FacilityProfile>) {
    setFacilityProfiles((prev) => ({
      ...prev,
      [selectedProfile]: { ...prev[selectedProfile], ...patches },
    }));
    void applyRigBonuses(
      { ...facilityProfiles[selectedProfile], ...patches },
      patches.rigTypeIds ?? facilityProfiles[selectedProfile].rigTypeIds ?? [],
    ).then((composed) => {
      setFacilityProfiles((prev) => ({
        ...prev,
        [selectedProfile]: {
          ...prev[selectedProfile],
          meBonus: composed.meBonus,
          teBonusPct: composed.teBonusPct,
          costBonus: composed.costBonus,
          rigTypeIds: composed.rigTypeIds,
        },
      }));
    });
  }

  const isComplete = buildBlueprintTypeId != null;
  const steps: { value: Step; label: string }[] = STEPS.map((s) => ({
    value: s,
    label: s,
  }));

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {steps.map((s, i) => (
          <button
            key={s.value}
            onClick={() => setStep(s.value)}
            className={`rounded px-3 py-1.5 text-sm ${
              step === s.value
                ? "bg-indigo-600 text-white"
                : i < stepIdx
                  ? "bg-zinc-700 text-zinc-200"
                  : "text-zinc-500"
            }`}
          >
            {i + 1}. {s.label}
          </button>
        ))}
      </div>

      {step === "Blueprint" && (
        <BlueprintStep
          bpSearch={bpSearch}
          setBpSearch={setBpSearch}
          searchResults={searchResults}
          onSelect={(bp) => {
            setBuildBlueprintTypeId(bp.typeId);
            setBuildBpMe(ownedMeForBp ?? me);
            setBuildBpTe(ownedTeForBp ?? te);
            setBuildRuns(1);
            setBuildSearchResult(bp);
            setBpSearch("");
          }}
          buildSearchResult={buildSearchResult}
          buildBpMe={buildBpMe}
          setBuildBpMe={setBuildBpMe}
          buildBpTe={buildBpTe}
          setBuildBpTe={setBuildBpTe}
          buildRuns={buildRuns}
          setBuildRuns={setBuildRuns}
        />
      )}

      {step === "Facility" && (
        <FacilityStep
          selectedProfile={selectedProfile}
          setSelectedProfile={setSelectedProfile}
          profile={profile}
          maxRigSize={maxRigSize}
          structureOptions={
            structureOptions as [FacilityStructureKey, { label: string }][]
          }
          updateProfile={updateProfile}
          regionId={regionId}
          setRegionId={setRegionId}
          stationId={stationId}
          setStationId={setStationId}
          stations={stations}
          regions={regions?.data ?? []}
        />
      )}

      {step === "Options" && (
        <OptionsStep
          buildComponents={buildComponents}
          setBuildComponents={setBuildComponents}
          ignoreBuildFuelBlocks={ignoreBuildFuelBlocks}
          setIgnoreBuildFuelBlocks={setIgnoreBuildFuelBlocks}
          ignoreBuildRams={ignoreBuildRams}
          setIgnoreBuildRams={setIgnoreBuildRams}
          useStock={useStock}
          setUseStock={setUseStock}
          componentMe={componentMe}
          setComponentMe={setComponentMe}
          componentTe={componentTe}
          setComponentTe={setComponentTe}
          timeSkill={timeSkill}
          setTimeSkill={setTimeSkill}
          includeSaleCost={includeSaleCost}
          setIncludeSaleCost={setIncludeSaleCost}
          sellBrokerPct={sellBrokerPct}
          setSellBrokerPct={setSellBrokerPct}
          sellTaxPct={sellTaxPct}
          setSellTaxPct={setSellTaxPct}
          materialBasis={materialBasis}
          setMaterialBasis={setMaterialBasis}
          productBasis={productBasis}
          setProductBasis={setProductBasis}
          productBestHub={productBestHub}
          setProductBestHub={setProductBestHub}
          blueprintCostPerRun={blueprintCostPerRun}
          setBlueprintCostPerRun={setBlueprintCostPerRun}
          inventionSkill={inventionSkill}
          setInventionSkill={setInventionSkill}
          decryptorTypeId={decryptorTypeId}
          setDecryptorTypeId={setDecryptorTypeId}
          decryptors={decryptors}
          implant={implant}
          setImplant={setImplant}
        />
      )}

      {step === "Results" && (
        <ResultsStep
          buildProfit={buildProfit}
          calculateBuild={calculateBuild}
          isComplete={isComplete}
        />
      )}

      <div className="flex justify-between pt-4 border-t border-zinc-800">
        <button
          onClick={() => setStep(STEPS[Math.max(0, stepIdx - 1)])}
          disabled={stepIdx === 0}
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
        >
          Back
        </button>
        {canNext ? (
          <button
            onClick={() =>
              setStep(STEPS[Math.min(STEPS.length - 1, stepIdx + 1)])
            }
            disabled={step === "Blueprint" && !isComplete}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Next
          </button>
        ) : (
          <button
            onClick={calculateBuild}
            disabled={!isComplete || buildProfit.isPending}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {buildProfit.isPending ? "Pricing…" : "Calculate"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Step 1: Blueprint search + ME/TE/RP inputs. */
function BlueprintStep({
  bpSearch,
  setBpSearch,
  searchResults,
  onSelect,
  buildSearchResult,
  buildBpMe,
  setBuildBpMe,
  buildBpTe,
  setBuildBpTe,
  buildRuns,
  setBuildRuns,
}: {
  bpSearch: string;
  setBpSearch: (s: string) => void;
  searchResults: BlueprintSearchResult[];
  onSelect: (bp: BlueprintSearchResult) => void;
  buildSearchResult: BlueprintSearchResult | null;
  buildBpMe: number;
  setBuildBpMe: (n: number) => void;
  buildBpTe: number;
  setBuildBpTe: (n: number) => void;
  buildRuns: number;
  setBuildRuns: (n: number) => void;
}) {
  return (
    <div className="space-y-4">
      <Field label="Search blueprint">
        <div className="relative">
          <input
            value={bpSearch}
            onChange={(e) => setBpSearch(e.currentTarget.value)}
            placeholder="e.g. Hecate, Vexor Navy Issue…"
            className="w-full rounded bg-zinc-800 px-2 py-1.5 pl-8 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500"
          />
        </div>
        {searchResults.length > 0 && (
          <div className="mt-1 max-h-48 overflow-auto rounded border border-zinc-700 bg-zinc-900 text-sm">
            {searchResults.map((bp) => (
              <button
                key={bp.typeId}
                onClick={() => onSelect(bp)}
                className="block w-full px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-800"
              >
                {bp.name}
              </button>
            ))}
          </div>
        )}
      </Field>

      {buildSearchResult && (
        <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="text-sm font-medium text-zinc-200">
            {buildSearchResult.name}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Blueprint type ID: {buildSearchResult.typeId}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Num
          label="ME (this blueprint)"
          value={buildBpMe}
          min={0}
          max={10}
          onChange={setBuildBpMe}
        />
        <Num
          label="TE (this blueprint)"
          value={buildBpTe}
          min={0}
          max={20}
          onChange={setBuildBpTe}
        />
        <Num label="Runs" value={buildRuns} min={1} onChange={setBuildRuns} />
      </div>
    </div>
  );
}

/** Step 2: Facility — structure, rigs, tax, cost index. */
function FacilityStep({
  selectedProfile,
  setSelectedProfile,
  profile,
  maxRigSize,
  structureOptions,
  updateProfile,
  regionId,
  setRegionId,
  stationId,
  setStationId,
  stations,
  regions,
}: {
  selectedProfile: "manufacturing" | "components" | "reaction";
  setSelectedProfile: (s: "manufacturing" | "components" | "reaction") => void;
  profile: FacilityProfile;
  maxRigSize: number;
  structureOptions: [FacilityStructureKey, { label: string }][];
  updateProfile: (patches: Partial<FacilityProfile>) => void;
  regionId: number;
  setRegionId: (id: number) => void;
  stationId: number | null;
  setStationId: (id: number | null) => void;
  stations: { id: number; name: string }[];
  regions: {
    id: number;
    name: string;
    stations: { id: number; name: string }[];
  }[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["manufacturing", "components", "reaction"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setSelectedProfile(p)}
            className={`rounded px-3 py-1.5 text-sm ${
              selectedProfile === p
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {p === "manufacturing"
              ? "Manufacturing"
              : p === "components"
                ? "Components"
                : "Reaction"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Region">
          <RegionSelect
            regions={regions}
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
        <Field label="Structure">
          <select
            value={profile.structure}
            onChange={(e) =>
              updateProfile({
                structure: e.target.value as FacilityStructureKey,
              })
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
        <Field label="Tax (%)">
          <input
            type="number"
            value={profile.taxRate ?? ""}
            onChange={(e) =>
              updateProfile({
                taxRate: e.target.value ? Number(e.target.value) / 100 : null,
              })
            }
            step={0.1}
            min={0}
            max={100}
            placeholder="auto"
            className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </Field>
      </div>

      <CostIndexField
        value={profile.systemCostIndex}
        onChange={(v) => updateProfile({ systemCostIndex: v })}
        systemId={profile.systemId}
        onSystemChange={(id) => updateProfile({ systemId: id })}
      />

      <Field label="Rigs">
        <MultiCombo
          facilityType={profile.facilityType}
          maxRigSize={maxRigSize}
          selectedIds={profile.rigTypeIds ?? []}
          onChange={(ids) => updateProfile({ rigTypeIds: ids })}
        />
      </Field>
    </div>
  );
}

/** Step 3: Build options — components, fuel blocks, stock, implants, sales. */
function OptionsStep({
  buildComponents,
  setBuildComponents,
  ignoreBuildFuelBlocks,
  setIgnoreBuildFuelBlocks,
  ignoreBuildRams,
  setIgnoreBuildRams,
  useStock,
  setUseStock,
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
  decryptors,
  implant,
  setImplant,
}: {
  buildComponents: boolean;
  setBuildComponents: (b: boolean) => void;
  ignoreBuildFuelBlocks: boolean;
  setIgnoreBuildFuelBlocks: (b: boolean) => void;
  ignoreBuildRams: boolean;
  setIgnoreBuildRams: (b: boolean) => void;
  useStock: boolean;
  setUseStock: (b: boolean) => void;
  componentMe: number;
  setComponentMe: (n: number) => void;
  componentTe: number;
  setComponentTe: (n: number) => void;
  timeSkill: number;
  setTimeSkill: (n: number) => void;
  includeSaleCost: boolean;
  setIncludeSaleCost: (b: boolean) => void;
  sellBrokerPct: number;
  setSellBrokerPct: (n: number) => void;
  sellTaxPct: number;
  setSellTaxPct: (n: number) => void;
  materialBasis: PriceBasis;
  setMaterialBasis: (b: PriceBasis) => void;
  productBasis: PriceBasis;
  setProductBasis: (b: PriceBasis) => void;
  productBestHub: boolean;
  setProductBestHub: (b: boolean) => void;
  blueprintCostPerRun: number;
  setBlueprintCostPerRun: (n: number) => void;
  inventionSkill: number;
  setInventionSkill: (n: number) => void;
  decryptorTypeId: number | null;
  setDecryptorTypeId: (id: number | null) => void;
  decryptors: { data?: { typeId: number; name: string }[] };
  implant: ImplantBonus | null;
  setImplant: (b: ImplantBonus | null) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={buildComponents}
            onChange={(e) => setBuildComponents(e.currentTarget.checked)}
          />
          Build sub-components
        </label>
        <label className="flex items-center gap-1 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={ignoreBuildFuelBlocks}
            onChange={(e) => setIgnoreBuildFuelBlocks(e.currentTarget.checked)}
          />
          Buy fuel blocks
        </label>
        <label className="flex items-center gap-1 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={ignoreBuildRams}
            onChange={(e) => setIgnoreBuildRams(e.currentTarget.checked)}
          />
          Buy R.A.M.
        </label>
        <label className="flex items-center gap-1 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={useStock}
            onChange={(e) => setUseStock(e.currentTarget.checked)}
          />
          Use character stock
        </label>
        <label className="flex items-center gap-1 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={includeSaleCost}
            onChange={(e) => setIncludeSaleCost(e.currentTarget.checked)}
          />
          Include sale costs
        </label>
        <label className="flex items-center gap-1 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={productBestHub}
            onChange={(e) => setProductBestHub(e.currentTarget.checked)}
          />
          Sell at best hub
        </label>
      </div>

      {buildComponents && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Num
            label="Component ME"
            value={componentMe}
            min={0}
            max={10}
            onChange={setComponentMe}
            placeholder="fallback for un-owned"
          />
          <Num
            label="Component TE"
            value={componentTe}
            min={0}
            max={20}
            onChange={setComponentTe}
            placeholder="fallback for un-owned"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Num
          label="Time skills (0-5)"
          value={timeSkill}
          min={0}
          max={5}
          onChange={setTimeSkill}
        />
        <Num
          label="Blueprint cost / run"
          value={blueprintCostPerRun}
          min={0}
          step={1000000}
          onChange={setBlueprintCostPerRun}
        />
        <Num
          label="Invention skills (0-5)"
          value={inventionSkill}
          min={0}
          max={5}
          onChange={setInventionSkill}
        />
      </div>

      <Field label="Decryptor (T2 invention)">
        <select
          value={decryptorTypeId ?? ""}
          onChange={(e) =>
            setDecryptorTypeId(
              e.target.value === "" ? null : Number(e.target.value),
            )
          }
          className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none"
        >
          <option value="">None</option>
          {decryptors.data?.map((d) => (
            <option key={d.typeId} value={d.typeId}>
              {d.name.replace(/ Decryptor$/, "")}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Price basis">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <BasisSelect value={materialBasis} onChange={setMaterialBasis} />
          <BasisSelect value={productBasis} onChange={setProductBasis} />
        </div>
      </Field>

      <Field label="Implant (optional)">
        <div className="grid grid-cols-3 gap-3">
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
                    : { timeBonusPct: v, materialBonus: 1.0, costBonusPct: 0 },
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
                    : { timeBonusPct: 0, materialBonus: 1.0, costBonusPct: v },
                )
              }
              placeholder="e.g. 2"
            />
          </div>
        </div>
        {implant && (
          <button
            onClick={() => setImplant(null)}
            className="mt-1 text-xs text-zinc-400 hover:text-zinc-200 underline"
          >
            Clear implant bonuses
          </button>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Num
          label="Sell broker fee (%)"
          value={sellBrokerPct}
          step={0.1}
          min={0}
          max={100}
          onChange={setSellBrokerPct}
        />
        <Num
          label="Sell tax (%)"
          value={sellTaxPct}
          step={0.1}
          min={0}
          max={100}
          onChange={setSellTaxPct}
        />
      </div>
    </div>
  );
}

/** Step 4: Calculate button + readiness check. */
function ResultsStep({
  buildProfit,
  calculateBuild,
  isComplete,
}: {
  buildProfit: { isPending: boolean; isError: boolean };
  calculateBuild: () => void;
  isComplete: boolean;
}) {
  return (
    <div className="space-y-4">
      {!isComplete && (
        <p className="text-sm text-zinc-500">
          Select a blueprint in Step 1 to begin.
        </p>
      )}
      {isComplete && (
        <button
          onClick={calculateBuild}
          disabled={buildProfit.isPending}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {buildProfit.isPending ? "Pricing…" : "Calculate build"}
        </button>
      )}
    </div>
  );
}
