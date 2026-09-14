import { create } from 'zustand';

// Stato globale dell'app.
export const useStore = create((set) => ({
  // Lista aerei attualmente visibili (state vector normalizzati).
  flights: [],
  // icao24 dell'aereo selezionato (pannello dettagli aperto).
  selectedId: null,
  // true quando è aperta la visuale frontale 3D.
  frontalOpen: false,
  // Stato del fetch: 'idle' | 'loading' | 'ok' | 'error'
  fetchStatus: 'idle',
  fetchError: null,

  setFlights: (flights) => set({ flights }),
  setFetchStatus: (fetchStatus, fetchError = null) =>
    set({ fetchStatus, fetchError }),
  selectFlight: (icao24) => set({ selectedId: icao24 }),
  clearSelection: () => set({ selectedId: null, frontalOpen: false }),
  openFrontal: () => set({ frontalOpen: true }),
  closeFrontal: () => set({ frontalOpen: false }),
}));

// Selector helper: l'aereo selezionato completo.
export const useSelectedFlight = () =>
  useStore((s) => s.flights.find((f) => f.icao24 === s.selectedId) || null);
