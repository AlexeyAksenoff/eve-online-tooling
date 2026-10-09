import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import type { AmmoChargeRow } from "../../lib/api";
import { invokeMock, mockInvoke, renderWithQuery } from "../../test/harness";

import { AmmoPage } from "./AmmoPage";

const SDE_OK = { installed: true, path: "/sde", sizeBytes: 1, updated: false };

const ANTIMATTER: AmmoChargeRow = {
  typeId: 1,
  name: "Antimatter Charge S",
  tier: "T1",
  family: "hybrid",
  turretClass: null,
  em: 0,
  thermal: 5,
  kinetic: 7,
  explosive: 0,
  totalDamage: 12,
  optimalMult: 0.5,
  falloffMult: 1,
  trackingMult: 1,
  capNeedBonusPct: null,
};

const VOID: AmmoChargeRow = {
  typeId: 2,
  name: "Void S",
  tier: "T2",
  family: "hybrid",
  turretClass: "Blaster",
  em: 0,
  thermal: 8.9,
  kinetic: 8.9,
  explosive: 0,
  totalDamage: 17.8,
  optimalMult: 0.75,
  falloffMult: 0.5,
  trackingMult: 0.75,
  capNeedBonusPct: 25,
};

const HYBRID_ROWS = [ANTIMATTER, VOID];

const SCORCH: AmmoChargeRow = {
  typeId: 3,
  name: "Scorch S",
  tier: "T2",
  family: "laser",
  turretClass: "Pulse",
  em: 10,
  thermal: 2,
  kinetic: 0,
  explosive: 0,
  totalDamage: 12,
  optimalMult: 2,
  falloffMult: 0.2,
  trackingMult: 1.2,
  capNeedBonusPct: 20,
};

beforeEach(() => {
  invokeMock.mockReset();
  localStorage.clear();
});

describe("AmmoPage", () => {
  it("renders T1 and T2 hybrid charges, with the T2 turret-class label", async () => {
    mockInvoke({
      sde_status: () => SDE_OK,
      ammo_reference: () => HYBRID_ROWS,
    });
    renderWithQuery(<AmmoPage />);

    expect(await screen.findByText("Antimatter Charge S")).toBeInTheDocument();
    expect(screen.getByText("Void S")).toBeInTheDocument();
    expect(screen.getByText("Blaster only")).toBeInTheDocument();
  });

  it("re-fetches with the selected family when the family switch changes", async () => {
    mockInvoke({
      sde_status: () => SDE_OK,
      ammo_reference: (args) => {
        const { family } = args as { family: string };
        return family === "laser" ? [SCORCH] : HYBRID_ROWS;
      },
    });
    renderWithQuery(<AmmoPage />);

    await screen.findByText("Antimatter Charge S");
    fireEvent.click(screen.getByText("Laser"));

    expect(await screen.findByText("Scorch S")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("ammo_reference", {
      family: "laser",
    });
  });

  it("filters rows by tier", async () => {
    mockInvoke({
      sde_status: () => SDE_OK,
      ammo_reference: () => HYBRID_ROWS,
    });
    renderWithQuery(<AmmoPage />);

    await screen.findByText("Antimatter Charge S");
    fireEvent.click(screen.getByRole("button", { name: "T2" }));

    expect(screen.queryByText("Antimatter Charge S")).not.toBeInTheDocument();
    expect(screen.getByText("Void S")).toBeInTheDocument();
  });

  it("sorts by damage when the Damage header is clicked", async () => {
    mockInvoke({
      sde_status: () => SDE_OK,
      ammo_reference: () => HYBRID_ROWS,
    });
    renderWithQuery(<AmmoPage />);

    await screen.findByText("Antimatter Charge S");
    fireEvent.click(screen.getByText("Damage"));

    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    const names = rows.map(
      (r) => within(r).getAllByRole("cell")[1].textContent,
    );
    // Damage defaults to descending on first click: Void (17.8) before
    // Antimatter (12).
    expect(names[0]).toContain("Void S");
    expect(names[1]).toContain("Antimatter Charge S");
  });
});
