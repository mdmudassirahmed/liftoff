import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { CSP, CSPCanvasMap, CSPCanvasSnapshot } from '@/types';

interface CSPState {
  // Active CSP
  activeCsp: CSP;

  // Per-CSP canvas snapshots (serialized nodes+edges)
  canvasSnapshots: CSPCanvasMap;

  // Actions
  setActiveCsp: (csp: CSP) => void;
  saveSnapshot: (csp: CSP, snapshot: CSPCanvasSnapshot) => void;
  getSnapshot: (csp: CSP) => CSPCanvasSnapshot | undefined;
  clearSnapshot: (csp: CSP) => void;
}

export const useCspStore = create<CSPState>()(
  devtools(
    persist(
      (set, get) => ({
        activeCsp: 'azure',
        canvasSnapshots: {},

        setActiveCsp: (csp) => set({ activeCsp: csp }),

        saveSnapshot: (csp, snapshot) =>
          set((state) => ({
            canvasSnapshots: { ...state.canvasSnapshots, [csp]: snapshot },
          })),

        getSnapshot: (csp) => get().canvasSnapshots[csp],

        clearSnapshot: (csp) =>
          set((state) => {
            const next = { ...state.canvasSnapshots };
            delete next[csp];
            return { canvasSnapshots: next };
          }),
      }),
      { name: 'liftoff-csp-store', partialize: (s) => ({ activeCsp: s.activeCsp }) }
    ),
    { name: 'CSPStore' }
  )
);

export default useCspStore;
