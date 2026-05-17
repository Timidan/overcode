import { create } from "zustand";
import type { AIFeature, AIFeaturePayload } from "../lib/ai-features";

interface AIPanelState {
  isOpen: boolean;
  feature: AIFeature | null;
  payload: AIFeaturePayload | null;
  /**
   * Open a feature view inside the AI panel. `payload` is optional so the
   * home view can navigate to features that gather their own context
   * (e.g. issue_triage). External callers that pass a payload keep working
   * unchanged — this is an additive relaxation of the signature.
   */
  open: (feature: AIFeature, payload?: AIFeaturePayload) => void;
  close: () => void;
  toggle: () => void;
}

export const useAIPanel = create<AIPanelState>((set) => ({
  isOpen: false,
  feature: null,
  payload: null,
  open: (feature, payload) =>
    set({ isOpen: true, feature, payload: payload ?? null }),
  close: () => set({ isOpen: false, feature: null, payload: null }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
