import { usePersistentState } from "../../lib/usePersistentState";
import { STORAGE_KEYS } from "../../lib/storageKeys";

/**
 * Whether closing the main window should ask for confirmation first (#NNN).
 * Default **on** — the whole point of the setting is to catch an accidental
 * close (a stray Alt+F4/⌘Q, a muscle-memory click on the OS close button),
 * so it protects by default; this is the one toggle in Settings an opt-*in*
 * default would defeat the purpose of.
 */
export function useConfirmBeforeQuit() {
  return usePersistentState<boolean>(STORAGE_KEYS.confirmBeforeQuit, true);
}
