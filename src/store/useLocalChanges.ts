import { create } from "zustand";

/**
 * Right-slide panel that aggregates dirty files across all workspace repos.
 * Opens from the Dashboard "Local changes detected" stat card. The panel
 * itself owns the data fetch — this store is just the open/close hinge so
 * any surface in the app can summon it.
 *
 * Open is idempotent: calling open() while already open is a no-op for the
 * store, but the panel watches `isOpen` transitions and additionally
 * exposes a `refreshTick` you can bump to force a re-fetch even when the
 * panel was already open.
 */
interface LocalChangesState {
  isOpen: boolean;
  /** Monotonic counter — incremented on every open() call. The panel
   *  effect depends on it so a second open() while already mounted
   *  still triggers a re-fetch (matches the "open is idempotent → refresh"
   *  contract in the spec). */
  refreshTick: number;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useLocalChanges = create<LocalChangesState>((set) => ({
  isOpen: false,
  refreshTick: 0,
  open: () =>
    set((state) => ({
      isOpen: true,
      refreshTick: state.refreshTick + 1,
    })),
  close: () => set({ isOpen: false }),
  toggle: () =>
    set((state) => ({
      isOpen: !state.isOpen,
      refreshTick: state.isOpen ? state.refreshTick : state.refreshTick + 1,
    })),
}));
