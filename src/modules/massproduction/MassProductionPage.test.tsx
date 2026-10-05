import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { MassProductionPlan } from "../../lib/api";
import { invokeMock, mockInvoke, renderWithQuery } from "../../test/harness";

import { MassProductionPage } from "./MassProductionPage";

const SDE_OK = { installed: true, path: "/sde", sizeBytes: 1, updated: false };

const PLAN: MassProductionPlan = {
  unresolvedNames: ["Not A Real Blueprint"],
  matchedBlueprints: [
    {
      name: "5MN Microwarpdrive II Blueprint",
      typeId: 1073,
      ownedCopies: 30,
      totalRuns: 300,
      assumed: null,
      tier: "Tech II",
    },
  ],
  groups: [
    {
      groupName: "Mineral",
      categoryName: "Material",
      items: [{ typeId: 11399, name: "Morphite", quantity: 5010 }],
    },
  ],
};

const HYPOTHETICAL_PLAN: MassProductionPlan = {
  unresolvedNames: [],
  matchedBlueprints: [
    {
      name: "Republic Fleet Gyrostabilizer Blueprint",
      typeId: 2000,
      ownedCopies: 0,
      totalRuns: 1,
      assumed: { runs: 1, materialEfficiency: 0, specialEdition: true },
      tier: "Faction",
    },
  ],
  groups: [
    {
      groupName: "Mineral",
      categoryName: "Material",
      items: [{ typeId: 34, name: "Tritanium", quantity: 100 }],
    },
  ],
};

const MWD_PLAN: MassProductionPlan = {
  unresolvedNames: [],
  matchedBlueprints: [
    {
      name: "5MN Microwarpdrive II Blueprint",
      typeId: 1073,
      ownedCopies: 30,
      totalRuns: 300,
      assumed: null,
      tier: "Tech II",
    },
  ],
  groups: [
    {
      groupName: "Mineral",
      categoryName: "Material",
      items: [{ typeId: 11399, name: "Morphite", quantity: 5010 }],
    },
  ],
};

async function pasteAndImport(text: string) {
  fireEvent.click(
    await screen.findByRole("button", { name: "Paste blueprint names" }),
  );
  const textarea = screen.getByPlaceholderText(/paste blueprint names/);
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("MassProductionPage", () => {
  it("surfaces unresolved names and renders grouped materials", async () => {
    mockInvoke({
      sde_status: () => SDE_OK,
      massprod_plan: () => PLAN,
    });
    renderWithQuery(<MassProductionPage />);

    await pasteAndImport(
      "5MN Microwarpdrive II Blueprint\nNot A Real Blueprint",
    );

    expect(await screen.findByText(/Not A Real Blueprint/)).toBeInTheDocument();
    expect(
      screen.getByText("5MN Microwarpdrive II Blueprint"),
    ).toBeInTheDocument();
    expect(screen.getByText("Mineral")).toBeInTheDocument();
    expect(screen.getByText("Morphite")).toBeInTheDocument();

    expect(invokeMock).toHaveBeenCalledWith("massprod_plan", {
      lines: [
        { name: "5MN Microwarpdrive II Blueprint", buildRuns: null },
        { name: "Not A Real Blueprint", buildRuns: null },
      ],
      mode: "owned",
      hypotheticalConfig: { t1Runs: 1, t1Me: 10, t2Me: 2 },
    });
  });

  it("switches to Hypothetical mode, sends the config, and flags special-edition items", async () => {
    mockInvoke({
      sde_status: () => SDE_OK,
      massprod_plan: () => HYPOTHETICAL_PLAN,
    });
    renderWithQuery(<MassProductionPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Hypothetical" }),
    );
    // The settings row only shows up in Hypothetical mode.
    expect(screen.getByText("T1 assumed runs")).toBeInTheDocument();

    await pasteAndImport("Republic Fleet Gyrostabilizer Blueprint");

    expect(
      await screen.findByText("Republic Fleet Gyrostabilizer Blueprint"),
    ).toBeInTheDocument();
    expect(screen.getByText("Special edition · ME0")).toBeInTheDocument();

    expect(invokeMock).toHaveBeenCalledWith("massprod_plan", {
      lines: [
        { name: "Republic Fleet Gyrostabilizer Blueprint", buildRuns: null },
      ],
      mode: "hypothetical",
      hypotheticalConfig: { t1Runs: 1, t1Me: 10, t2Me: 2 },
    });
  });

  it("saves a group as a new shopping list", async () => {
    mockInvoke({
      sde_status: () => SDE_OK,
      massprod_plan: () => PLAN,
      shopping_create_list: () => ({
        id: "morphite-run",
        name: "Morphite run",
        removable: true,
        items: [],
      }),
      shopping_add_item: () => undefined,
    });
    renderWithQuery(<MassProductionPage />);

    await pasteAndImport("5MN Microwarpdrive II Blueprint");
    await screen.findByText("Mineral");

    fireEvent.click(
      screen.getByRole("button", { name: "Save as new shopping list…" }),
    );
    const nameInput = screen.getByPlaceholderText(/Mineral/);
    fireEvent.change(nameInput, { target: { value: "Morphite run" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("shopping_create_list", {
        name: "Morphite run",
      }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("shopping_add_item", {
        id: "morphite-run",
        typeId: 11399,
        quantity: 5010,
      }),
    );
    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
  });

  it("groups the matched blueprints by tech tier", async () => {
    const TIERED_PLAN: MassProductionPlan = {
      unresolvedNames: [],
      matchedBlueprints: [
        {
          name: "Widget I Blueprint",
          typeId: 998,
          ownedCopies: 5,
          totalRuns: 5,
          assumed: null,
          tier: "Tech I",
        },
        MWD_PLAN.matchedBlueprints[0],
      ],
      groups: [],
    };
    mockInvoke({
      sde_status: () => SDE_OK,
      massprod_plan: () => TIERED_PLAN,
    });
    renderWithQuery(<MassProductionPage />);

    await pasteAndImport("Widget I Blueprint\n5MN Microwarpdrive II Blueprint");

    expect(await screen.findByText("Tech I")).toBeInTheDocument();
    expect(screen.getByText("Tech II")).toBeInTheDocument();
    expect(screen.getByText("Widget I Blueprint")).toBeInTheDocument();
    expect(
      screen.getByText("5MN Microwarpdrive II Blueprint"),
    ).toBeInTheDocument();
  });

  it("edits a blueprint's build-runs and recomputes the plan with the override", async () => {
    const overriddenPlan: MassProductionPlan = {
      ...MWD_PLAN,
      matchedBlueprints: [{ ...MWD_PLAN.matchedBlueprints[0], totalRuns: 50 }],
    };
    mockInvoke({
      sde_status: () => SDE_OK,
      massprod_plan: (args) => {
        const { lines } = args as {
          lines: { buildRuns?: number | null }[];
        };
        return lines.some((l) => l.buildRuns === 50)
          ? overriddenPlan
          : MWD_PLAN;
      },
    });
    renderWithQuery(<MassProductionPage />);

    await pasteAndImport("5MN Microwarpdrive II Blueprint");
    const input = await screen.findByLabelText("Runs to build of 1073");
    expect(input).toHaveValue(300);

    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("massprod_plan", {
        lines: [{ name: "5MN Microwarpdrive II Blueprint", buildRuns: 50 }],
        mode: "owned",
        hypotheticalConfig: { t1Runs: 1, t1Me: 10, t2Me: 2 },
      }),
    );
    expect(await screen.findByLabelText("Runs to build of 1073")).toHaveValue(
      50,
    );
  });

  it("saves, loads, and deletes a build list", async () => {
    const SAVED_LIST = {
      id: "doctrine",
      name: "Doctrine",
      items: [
        {
          typeId: 1073,
          name: "5MN Microwarpdrive II Blueprint",
          buildRuns: 50,
        },
      ],
    };
    mockInvoke({
      sde_status: () => SDE_OK,
      massprod_plan: () => MWD_PLAN,
      massprod_lists: () => [SAVED_LIST],
      massprod_save_list: () => SAVED_LIST,
      massprod_delete_list: () => undefined,
    });
    renderWithQuery(<MassProductionPage />);

    await pasteAndImport("5MN Microwarpdrive II Blueprint");
    await screen.findByText("Mineral");

    fireEvent.click(screen.getByRole("button", { name: /Save build list/ }));
    const nameInput = screen.getByPlaceholderText(/Build list/);
    fireEvent.change(nameInput, { target: { value: "Doctrine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("massprod_save_list", {
        name: "Doctrine",
        items: [{ typeId: 1073, buildRuns: null }],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Build lists" }));
    const loadButton = await screen.findByTitle(
      'Load "Doctrine" (1 blueprints)',
    );
    fireEvent.click(loadButton);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("massprod_plan", {
        lines: [{ name: "5MN Microwarpdrive II Blueprint", buildRuns: 50 }],
        mode: "owned",
        hypotheticalConfig: { t1Runs: 1, t1Me: 10, t2Me: 2 },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Build lists" }));
    const deleteButton = await screen.findByRole("button", {
      name: "Delete Doctrine",
    });
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("massprod_delete_list", {
        id: "doctrine",
      }),
    );
  });

  it("parses a build-run count on a pasted line and applies it as an override", async () => {
    const overriddenPlan: MassProductionPlan = {
      ...MWD_PLAN,
      matchedBlueprints: [{ ...MWD_PLAN.matchedBlueprints[0], totalRuns: 50 }],
    };
    mockInvoke({
      sde_status: () => SDE_OK,
      massprod_plan: () => overriddenPlan,
    });
    renderWithQuery(<MassProductionPage />);

    await pasteAndImport("5MN Microwarpdrive II Blueprint\t50");

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("massprod_plan", {
        lines: [{ name: "5MN Microwarpdrive II Blueprint", buildRuns: 50 }],
        mode: "owned",
        hypotheticalConfig: { t1Runs: 1, t1Me: 10, t2Me: 2 },
      }),
    );
    expect(await screen.findByLabelText("Runs to build of 1073")).toHaveValue(
      50,
    );
  });

  describe("exporting lists", () => {
    const writeText = vi.fn<(t: string) => Promise<void>>();
    beforeEach(() => {
      writeText.mockReset().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("copies the current blueprint list with its resolved run counts", async () => {
      mockInvoke({
        sde_status: () => SDE_OK,
        massprod_plan: () => MWD_PLAN,
      });
      renderWithQuery(<MassProductionPage />);

      await pasteAndImport("5MN Microwarpdrive II Blueprint");
      await screen.findByText("Mineral");

      fireEvent.click(screen.getByRole("button", { name: "Copy list" }));
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          "5MN Microwarpdrive II Blueprint\t300",
        ),
      );
    });

    it("copies a saved build list, omitting the count for lines with no override", async () => {
      mockInvoke({
        sde_status: () => SDE_OK,
        massprod_lists: () => [
          {
            id: "doctrine",
            name: "Doctrine",
            items: [
              {
                typeId: 1073,
                name: "5MN Microwarpdrive II Blueprint",
                buildRuns: 50,
              },
              { typeId: 999, name: "Widget I Blueprint", buildRuns: null },
            ],
          },
        ],
      });
      renderWithQuery(<MassProductionPage />);
      await screen.findByRole("button", { name: "Paste blueprint names" });

      fireEvent.click(screen.getByRole("button", { name: "Build lists" }));
      await screen.findByText("Doctrine");
      fireEvent.click(screen.getByRole("button", { name: "Copy Doctrine" }));

      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          "5MN Microwarpdrive II Blueprint\t50\nWidget I Blueprint",
        ),
      );
    });
  });
});
