import { create } from 'zustand';

const MAX_TRAIL = 40; // punti massimi di scia per aereo

// Stato globale dell'app.
export const useStore = create((set) => ({
  // Lista aerei attualmente visibili (state vector normalizzati).
  flights: [],
  // Cronologia posizioni per aereo (per le scie 3D): icao -> [{lat,lon,altM}]
  history: {},
  // icao24 dell'aereo selezionato (pannello dettagli aperto).
  selectedId: null,
  // true quando è aperta la visuale frontale 3D (simulazione atterraggio).
  frontalOpen: false,
  // true quando è aperta la panoramica 3D (globo con tutti gli aerei).
  overview3D: false,
  // Stato del fetch: 'idle' | 'loading' | 'ok' | 'error'
  fetchStatus: 'idle',
  fetchError: null,

  setFlights: (flights) =>
    set((state) => {
      const hist = {};
      for (const f of flights) {
        const prev = state.history[f.icao24] || [];
        const last = prev[prev.length - 1];
        const altM = f.geoAltitude ?? f.baroAltitude ?? 0;
        const arr =
          !last || last.lat !== f.lat || last.lon !== f.lon
            ? [...prev, { lat: f.lat, lon: f.lon, altM }].slice(-MAX_TRAIL)
            : prev;
        hist[f.icao24] = arr; // solo gli aerei ancora presenti (bounded)
      }
      return { flights, history: hist };
    }),
  setFetchStatus: (fetchStatus, fetchError = null) =>
    set({ fetchStatus, fetchError }),
  selectFlight: (icao24) => set({ selectedId: icao24 }),
  clearSelection: () => set({ selectedId: null, frontalOpen: false }),
  openFrontal: () => set({ frontalOpen: true }),
  closeFrontal: () => set({ frontalOpen: false }),
  openOverview3D: () => set({ overview3D: true }),
  closeOverview3D: () => set({ overview3D: false }),
}));

// Selector helper: l'aereo selezionato completo.
export const useSelectedFlight = () =>
  useStore((s) => s.flights.find((f) => f.icao24 === s.selectedId) || null);
