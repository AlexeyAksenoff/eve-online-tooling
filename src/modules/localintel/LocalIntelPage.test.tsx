import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { AppError, LocalPilot, LocalScanResult } from "../../lib/api";
import { invokeMock, mockInvoke, renderWithQuery } from "../../test/harness";
import { ModuleActiveContext } from "../../components/moduleActiveContext";

import { LocalIntelPage } from "./LocalIntelPage";

const sendNotificationMock = vi.fn();
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => Promise.resolve(true),
  requestPermission: () => Promise.resolve("granted"),
  sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
}));

type KillPayload = {
  killmailId: number;
  solarSystemId: number;
  timeSecs: number;
  victimFactionId: number | null;
  attackerFactionIds: number[];
  victimCorporationId: number | null;
  victimAllianceId: number | null;
  attackerCorporationIds: number[];
  attackerAllianceIds: number[];
};
let killHandlers: Array<(payload: KillPayload) => void> = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (e: { payload: unknown }) => void) => {
    if (name !== "zkill://kill") return Promise.resolve(() => {});
    const wrapped = (payload: KillPayload) => handler({ payload });
    killHandlers.push(wrapped);
    return Promise.resolve(() => {
      killHandlers = killHandlers.filter((h) => h !== wrapped);
    });
  },
}));

function fireKill(overrides: Partial<KillPayload>) {
  const payload: KillPayload = {
    killmailId: 1,
    solarSystemId: 1,
    timeSecs: Math.floor(Date.now() / 1000),
    victimFactionId: null,
    attackerFactionIds: [],
    victimCorporationId: null,
    victimAllianceId: null,
    attackerCorporationIds: [],
    attackerAllianceIds: [],
    ...overrides,
  };
  for (const h of [...killHandlers]) h(payload);
}
const PILOT: LocalPilot = {
  characterId: 12345,
  name: "Chribba",
  corporationId: 98765,
  corporation: "Otherworld Enterprises",
  allianceId: null,
  alliance: null,
  standing: 0,
  threat: "neutral",
  militia: null,
};

const RESULT: LocalScanResult = {
  pilots: [PILOT],
  reds: 0,
  neutrals: 1,
  blues: 0,
  unresolved: [],
  militiaCounts: [],
};

beforeEach(() => {
  invokeMock.mockReset();
  sendNotificationMock.mockClear();
  killHandlers = [];
});

describe("LocalIntelPage", () => {
  it("scans pasted names and renders a classified pilot", async () => {
    mockInvoke({
      localintel_scan: () => RESULT,
      localintel_zkill: () => [],
    });
    renderWithQuery(<LocalIntelPage />);

    fireEvent.change(
      screen.getByPlaceholderText(/paste the local member list/i),
      { target: { value: "Chribba" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /scan local/i }));

    expect(await screen.findByText("Chribba")).toBeInTheDocument();
  });

  it("shows the scan failure message", async () => {
    const error: AppError = { kind: "message", message: "ESI unreachable" };
    mockInvoke({
      localintel_scan: () => {
        throw error;
      },
    });
    renderWithQuery(<LocalIntelPage />);

    fireEvent.change(
      screen.getByPlaceholderText(/paste the local member list/i),
      { target: { value: "Chribba" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /scan local/i }));

    expect(await screen.findByText(/ESI unreachable/)).toBeInTheDocument();
  });

  it("polls the character location while the module is active", async () => {
    mockInvoke({ route_location: () => [] });
    renderWithQuery(<LocalIntelPage />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("route_location"),
    );
  });

  it("does not poll the character location while the module is hidden", async () => {
    mockInvoke({ route_location: () => [] });
    renderWithQuery(
      <ModuleActiveContext.Provider value={false}>
        <LocalIntelPage />
      </ModuleActiveContext.Provider>,
    );

    // Let any (wrongly) scheduled fetch flush before asserting.
    await new Promise((r) => setTimeout(r, 50));
    expect(invokeMock).not.toHaveBeenCalledWith("route_location");
  });

  it("tags an enlisted pilot with a militia chip and shows the per-militia summary", async () => {
    const militiaPilot: LocalPilot = { ...PILOT, militia: "Caldari State" };
    const result: LocalScanResult = {
      pilots: [militiaPilot],
      reds: 0,
      neutrals: 1,
      blues: 0,
      unresolved: [],
      militiaCounts: [{ militia: "Caldari State", count: 1 }],
    };
    mockInvoke({
      localintel_scan: () => result,
      localintel_zkill: () => [],
    });
    renderWithQuery(<LocalIntelPage />);

    fireEvent.change(
      screen.getByPlaceholderText(/paste the local member list/i),
      { target: { value: "Chribba" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /scan local/i }));

    await screen.findByText("Chribba");
    expect(screen.getAllByText("Caldari State").length).toBeGreaterThan(0);
    expect(screen.getByText(/Caldari State: 1/)).toBeInTheDocument();
  });

  it("notifies immediately on a live kill touching a watched corp/alliance (#927)", async () => {
    mockInvoke({
      localintel_get_watchlist: () => [
        { id: 98_000_001, name: "Watched Corp" },
      ],
      route_location: () => [],
    });
    renderWithQuery(<LocalIntelPage />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("localintel_get_watchlist"),
    );
    await waitFor(() => expect(killHandlers.length).toBeGreaterThan(0));

    fireKill({ victimCorporationId: 98_000_001 });

    await waitFor(() =>
      expect(sendNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("Watchlisted activity"),
        }),
      ),
    );
  });

  it("ignores a live kill that doesn't touch the watchlist", async () => {
    mockInvoke({
      localintel_get_watchlist: () => [
        { id: 98_000_001, name: "Watched Corp" },
      ],
      route_location: () => [],
    });
    renderWithQuery(<LocalIntelPage />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("localintel_get_watchlist"),
    );
    await waitFor(() => expect(killHandlers.length).toBeGreaterThan(0));

    fireKill({ victimCorporationId: 1 });
    await new Promise((r) => setTimeout(r, 20));

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});
