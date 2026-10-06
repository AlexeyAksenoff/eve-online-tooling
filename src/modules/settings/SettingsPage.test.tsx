import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { mockInvoke, invokeMock, renderWithQuery } from "../../test/harness";
import { SettingsPage } from "./SettingsPage";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

beforeEach(() => {
  invokeMock.mockReset();
  localStorage.clear();
});

describe("Settings: check for updates", () => {
  it("defaults the toggle to on and shows the latest status", async () => {
    mockInvoke({
      release_check_latest: () => ({
        currentVersion: "0.71.0",
        latestVersion: "0.71.0",
        isOutdated: false,
        htmlUrl:
          "https://github.com/th-lange/eve-online-tooling/releases/tag/v0.71.0",
        publishedAt: "2026-01-01T00:00:00Z",
      }),
    });
    renderWithQuery(<SettingsPage />);

    expect(screen.getByLabelText("Check for updates on startup")).toBeChecked();
    await waitFor(() =>
      expect(screen.getByText("Up to date (v0.71.0)")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "View release" }),
    ).not.toBeInTheDocument();
  });

  it("surfaces an available update with a link to the release", async () => {
    mockInvoke({
      release_check_latest: () => ({
        currentVersion: "0.71.0",
        latestVersion: "0.72.0",
        isOutdated: true,
        htmlUrl:
          "https://github.com/th-lange/eve-online-tooling/releases/tag/v0.72.0",
        publishedAt: "2026-02-01T00:00:00Z",
      }),
    });
    renderWithQuery(<SettingsPage />);

    await waitFor(() =>
      expect(
        screen.getByText("v0.72.0 is available (you're on v0.71.0)"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "View release" }),
    ).toBeInTheDocument();
  });

  it("'Check now' still works after the toggle is switched off", async () => {
    mockInvoke({
      release_check_latest: () => ({
        currentVersion: "0.71.0",
        latestVersion: "0.71.0",
        isOutdated: false,
        htmlUrl:
          "https://github.com/th-lange/eve-online-tooling/releases/tag/v0.71.0",
        publishedAt: "2026-01-01T00:00:00Z",
      }),
    });
    renderWithQuery(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByText("Up to date (v0.71.0)")).toBeInTheDocument(),
    );
    invokeMock.mockClear();

    fireEvent.click(screen.getByLabelText("Check for updates on startup"));
    expect(
      screen.getByLabelText("Check for updates on startup"),
    ).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("release_check_latest"),
    );
  });
});
