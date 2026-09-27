import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { invokeMock, mockInvoke, renderWithQuery } from "../../test/harness";
import { FactionWarfarePage } from "./FactionWarfarePage";
import type { FwSystemNode } from "../../lib/api";

function node(
  name: string,
  contested: string,
  id: number,
  occupierId = 500003,
  occupier = "Amarr",
  battlefield = "rearguard",
): FwSystemNode {
  return {
    systemId: id,
    name,
    region: "Devoid",
    warzone: "Amarr–Minmatar",
    security: 0.3,
    owner: occupier,
    occupier,
    ownerId: occupierId,
    occupierId,
    contested,
    vpPct: contested === "uncontested" ? 0 : 0.5,
    kills: 0,
    npcKills: 0,
    jumps: 0,
    battlefield,
    x: id * 1e15,
    z: id * 1e15,
  };
}
const NODES = [
  node("QuietTown", "uncontested", 1),
  node("FightVille", "contested", 2),
  node("VulnBurg", "vulnerable", 3),
  // Minmatar-occupied + contested — lets militia-perspective tests see both
  // "defend" (an Amarr-occupied contested system, from Amarr's perspective)
  // and "push" (this one, from Amarr's perspective) at once.
  node("RebelHold", "contested", 4, 500002, "Minmatar"),
];

// The star map renders system names too, so scope row assertions to the table.
const inTable = () => within(screen.getByRole("table"));

beforeEach(() => {
  invokeMock.mockReset();
  localStorage.clear();
  mockInvoke({
    intel_fw_stats: () => [],
    intel_fw_systems: () => ({ nodes: NODES, edges: [] }),
    auth_characters: () => [],
    auth_active_character: () => null,
  });
});

describe("FW warzone list filter", () => {
  it("filters the system table by contested / uncontested / all", async () => {
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getByText("QuietTown")).toBeInTheDocument(),
    );
    expect(inTable().getByText("FightVille")).toBeInTheDocument();
    expect(inTable().getByText("VulnBurg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Contested" }));
    await waitFor(() =>
      expect(inTable().queryByText("QuietTown")).not.toBeInTheDocument(),
    );
    expect(inTable().getByText("FightVille")).toBeInTheDocument();
    expect(inTable().getByText("VulnBurg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Uncontested" }));
    await waitFor(() =>
      expect(inTable().getByText("QuietTown")).toBeInTheDocument(),
    );
    expect(inTable().queryByText("FightVille")).not.toBeInTheDocument();
    expect(inTable().queryByText("VulnBurg")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() =>
      expect(inTable().getByText("FightVille")).toBeInTheDocument(),
    );
    expect(inTable().getByText("QuietTown")).toBeInTheDocument();
    expect(inTable().getByText("VulnBurg")).toBeInTheDocument();
  });
});

describe("FW militia perspective", () => {
  it("Observer mode is the default and has no Defend/Push column", async () => {
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getByText("QuietTown")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("columnheader", { name: /Perspective/i }),
    ).not.toBeInTheDocument();
    expect(inTable().queryByText("defend")).not.toBeInTheDocument();
    expect(inTable().queryByText("push")).not.toBeInTheDocument();
  });

  it("selecting a militia classifies contested systems as Defend or Push", async () => {
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getByText("QuietTown")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Amarr Empire" }));

    // FightVille + VulnBurg: Amarr-occupied and contested → defend.
    await waitFor(() =>
      expect(inTable().getAllByText("defend")).toHaveLength(2),
    );
    // RebelHold: Minmatar-occupied and contested → push, from Amarr's view.
    expect(inTable().getAllByText("push")).toHaveLength(1);
    // QuietTown: Amarr-occupied but uncontested → neither classification.
    const quietRow = inTable().getByText("QuietTown").closest("tr")!;
    expect(within(quietRow).queryByText("defend")).not.toBeInTheDocument();
    expect(within(quietRow).queryByText("push")).not.toBeInTheDocument();
  });

  it("flips Defend/Push when the opposing militia is selected", async () => {
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getByText("QuietTown")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Minmatar Republic" }));

    // From Minmatar's perspective, RebelHold (Minmatar-occupied) is defend,
    // and the two Amarr-occupied contested systems become push.
    await waitFor(() =>
      expect(inTable().getAllByText("defend")).toHaveLength(1),
    );
    expect(inTable().getAllByText("push")).toHaveLength(2);
  });

  it("auto-detects the militia from an enlisted character when unset", async () => {
    mockInvoke({
      intel_fw_stats: () => [],
      intel_fw_systems: () => ({ nodes: NODES, edges: [] }),
      auth_characters: () => [{ characterId: 1, name: "Bob", scopes: [] }],
      auth_active_character: () => 1,
      intel_fw_enlistment: () => 500003, // Amarr Empire
      intel_fw_jumps: () => ({ characterSystemId: 1, jumps: {} }),
    });
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(screen.getByText(/auto-detected/)).toBeInTheDocument(),
    );
    // Defaulted straight to Amarr's perspective without a click.
    await waitFor(() =>
      expect(inTable().getAllByText("defend")).toHaveLength(2),
    );
  });

  it("falls back to Observer when the character isn't enlisted", async () => {
    mockInvoke({
      intel_fw_stats: () => [],
      intel_fw_systems: () => ({ nodes: NODES, edges: [] }),
      auth_characters: () => [{ characterId: 1, name: "Bob", scopes: [] }],
      auth_active_character: () => 1,
      intel_fw_enlistment: () => null,
      intel_fw_jumps: () => ({ characterSystemId: 1, jumps: {} }),
    });
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getByText("QuietTown")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/auto-detected/)).not.toBeInTheDocument();
    expect(inTable().queryByText("defend")).not.toBeInTheDocument();
  });

  it("an explicit Observer pick overrides auto-detect and persists", async () => {
    mockInvoke({
      intel_fw_stats: () => [],
      intel_fw_systems: () => ({ nodes: NODES, edges: [] }),
      auth_characters: () => [{ characterId: 1, name: "Bob", scopes: [] }],
      auth_active_character: () => 1,
      intel_fw_enlistment: () => 500002, // Minmatar Republic
      intel_fw_jumps: () => ({ characterSystemId: 1, jumps: {} }),
    });
    const { unmount } = renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getAllByText("defend")).toHaveLength(1),
    );

    fireEvent.click(screen.getByRole("button", { name: "Observer" }));
    await waitFor(() =>
      expect(inTable().queryByText("defend")).not.toBeInTheDocument(),
    );
    unmount();

    // Remount: the explicit Observer choice persists over auto-detect.
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getByText("QuietTown")).toBeInTheDocument(),
    );
    expect(inTable().queryByText("defend")).not.toBeInTheDocument();
  });
});

describe("FW battlefield classification", () => {
  it("shows the derived battlefield chip per system, in Observer mode too", async () => {
    const battlefieldNodes = [
      node("EdgeSystem", "contested", 20, 500003, "Amarr", "frontline"),
      node("StagingSystem", "uncontested", 21, 500003, "Amarr", "commandops"),
      node("QuietBackwater", "uncontested", 22, 500003, "Amarr", "rearguard"),
    ];
    mockInvoke({
      intel_fw_stats: () => [],
      intel_fw_systems: () => ({ nodes: battlefieldNodes, edges: [] }),
      auth_characters: () => [],
      auth_active_character: () => null,
    });
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getByText("EdgeSystem")).toBeInTheDocument(),
    );
    expect(inTable().getByText("Frontline")).toBeInTheDocument();
    expect(inTable().getByText("Command Ops")).toBeInTheDocument();
    expect(inTable().getByText("Rearguard")).toBeInTheDocument();
  });
});

describe("FW NPC kills column", () => {
  it("shows NPC kills alongside ship kills, sortable", async () => {
    const withNpcKills = [
      { ...node("FarmSystem", "uncontested", 30), npcKills: 42 },
      { ...node("EmptySystem", "uncontested", 31), npcKills: 0 },
    ];
    mockInvoke({
      intel_fw_stats: () => [],
      intel_fw_systems: () => ({ nodes: withNpcKills, edges: [] }),
      auth_characters: () => [],
      auth_active_character: () => null,
    });
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getByText("FarmSystem")).toBeInTheDocument(),
    );
    expect(inTable().getByText("42")).toBeInTheDocument();

    // Sortable via its column header.
    fireEvent.click(
      screen.getByRole("columnheader", { name: /NPC Kills 1h/i }),
    );
    const rows = inTable().getAllByRole("row");
    // Header row + 2 data rows; after a desc-toggle click the highest NPC
    // kill count (FarmSystem) should lead.
    expect(within(rows[1]).queryByText("FarmSystem")).toBeInTheDocument();
  });
});

describe("FW proximity filter", () => {
  it("is hidden without an active character; 'all' behaves like before", async () => {
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getByText("QuietTown")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "3j" }),
    ).not.toBeInTheDocument();
    // All four fixture systems still present — unfiltered.
    expect(inTable().getByText("FightVille")).toBeInTheDocument();
    expect(inTable().getByText("VulnBurg")).toBeInTheDocument();
    expect(inTable().getByText("RebelHold")).toBeInTheDocument();
  });

  it("filters the table by jump radius when a character is active, and persists", async () => {
    mockInvoke({
      intel_fw_stats: () => [],
      intel_fw_systems: () => ({ nodes: NODES, edges: [] }),
      auth_characters: () => [{ characterId: 1, name: "Bob", scopes: [] }],
      auth_active_character: () => 1,
      // QuietTown 2j, FightVille 6j, VulnBurg 12j; RebelHold absent (unreachable).
      intel_fw_jumps: () => ({
        characterSystemId: 1,
        jumps: { "1": 2, "2": 6, "3": 12 },
      }),
      intel_fw_enlistment: () => null,
    });
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getByText("QuietTown")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "5j" }));
    await waitFor(() =>
      expect(inTable().queryByText("FightVille")).not.toBeInTheDocument(),
    );
    // Within 5 jumps: only QuietTown (2j). 6j/12j/unreachable all excluded.
    expect(inTable().getByText("QuietTown")).toBeInTheDocument();
    expect(inTable().queryByText("VulnBurg")).not.toBeInTheDocument();
    expect(inTable().queryByText("RebelHold")).not.toBeInTheDocument();
    expect(localStorage.getItem("fw.proximityRadius")).toBe('"5"');

    fireEvent.click(screen.getByRole("button", { name: "10j" }));
    await waitFor(() =>
      expect(inTable().getByText("FightVille")).toBeInTheDocument(),
    );
    // Within 10 jumps: QuietTown (2j) + FightVille (6j); 12j/unreachable stay out.
    expect(inTable().queryByText("VulnBurg")).not.toBeInTheDocument();
    expect(inTable().queryByText("RebelHold")).not.toBeInTheDocument();

    // Two "All" buttons exist (Show filter + proximity filter); the
    // proximity one renders second.
    fireEvent.click(screen.getAllByRole("button", { name: "All" })[1]);
    await waitFor(() =>
      expect(inTable().getByText("VulnBurg")).toBeInTheDocument(),
    );
    expect(inTable().getByText("RebelHold")).toBeInTheDocument();
  });

  it("combines with the contested filter in the count label", async () => {
    mockInvoke({
      intel_fw_stats: () => [],
      intel_fw_systems: () => ({ nodes: NODES, edges: [] }),
      auth_characters: () => [{ characterId: 1, name: "Bob", scopes: [] }],
      auth_active_character: () => 1,
      intel_fw_jumps: () => ({
        characterSystemId: 1,
        jumps: { "1": 2, "2": 3 },
      }),
      intel_fw_enlistment: () => null,
    });
    renderWithQuery(<FactionWarfarePage />);
    await waitFor(() =>
      expect(inTable().getByText("QuietTown")).toBeInTheDocument(),
    );

    // Within 5j: QuietTown (uncontested) + FightVille (contested) — 2 of 2.
    fireEvent.click(screen.getByRole("button", { name: "5j" }));
    await waitFor(() =>
      expect(screen.getByText("2 of 2 systems")).toBeInTheDocument(),
    );

    // Add the contested-only filter on top: 1 of 2 (FightVille only).
    fireEvent.click(screen.getByRole("button", { name: "Contested" }));
    await waitFor(() =>
      expect(screen.getByText("1 of 2 systems")).toBeInTheDocument(),
    );
  });
});
