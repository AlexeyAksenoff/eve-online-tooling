import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { ConfirmQuitProvider } from "./ConfirmQuitProvider";

// `onCloseRequested`'s registered handler is captured here so a test can
// fire it directly (simulating the OS close button), same shape as the real
// `CloseRequestedEvent` (`preventDefault`/`isPreventDefault`).
let closeHandler: ((event: { preventDefault: () => void }) => void) | undefined;
const destroy = vi.fn();
const preventDefault = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (
      handler: (event: { preventDefault: () => void }) => void,
    ) => {
      closeHandler = handler;
      return Promise.resolve(() => {
        closeHandler = undefined;
      });
    },
    destroy,
  }),
}));

beforeEach(() => {
  localStorage.clear();
  closeHandler = undefined;
  destroy.mockReset();
  preventDefault.mockReset();
});

function fireClose() {
  act(() => {
    closeHandler?.({ preventDefault });
  });
}

describe("ConfirmQuitProvider", () => {
  it("shows the confirm dialog and prevents the default close when the setting is on", async () => {
    render(
      <ConfirmQuitProvider>
        <div>content</div>
      </ConfirmQuitProvider>,
    );
    await waitFor(() => expect(closeHandler).toBeDefined());

    fireClose();

    expect(preventDefault).toHaveBeenCalled();
    expect(
      await screen.findByText("Quit EVE Online Tooling?"),
    ).toBeInTheDocument();
  });

  it("lets the close through untouched when the setting is off", async () => {
    localStorage.setItem("settings.confirmBeforeQuit", "false");
    render(
      <ConfirmQuitProvider>
        <div>content</div>
      </ConfirmQuitProvider>,
    );
    await waitFor(() => expect(closeHandler).toBeDefined());

    fireClose();

    expect(preventDefault).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Quit EVE Online Tooling?"),
    ).not.toBeInTheDocument();
  });

  it("destroys the window when Quit is clicked", async () => {
    render(
      <ConfirmQuitProvider>
        <div>content</div>
      </ConfirmQuitProvider>,
    );
    await waitFor(() => expect(closeHandler).toBeDefined());
    fireClose();

    fireEvent.click(await screen.findByRole("button", { name: "Quit" }));

    expect(destroy).toHaveBeenCalled();
  });

  it("dismisses the dialog without closing when Cancel is clicked", async () => {
    render(
      <ConfirmQuitProvider>
        <div>content</div>
      </ConfirmQuitProvider>,
    );
    await waitFor(() => expect(closeHandler).toBeDefined());
    fireClose();
    await screen.findByText("Quit EVE Online Tooling?");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(destroy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByText("Quit EVE Online Tooling?"),
      ).not.toBeInTheDocument(),
    );
  });
});
