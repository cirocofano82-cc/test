import { useEffect, useRef } from 'react';
import { fetchStatesInBBox } from '../api/opensky';
import { useStore } from '../store/useStore';

// Effettua il polling degli aerei nel bounding box corrente.
// L'accesso anonimo a OpenSky è rate-limited: default 15s.
export function useFlightPolling(bbox, intervalMs = 15000) {
  const setFlights = useStore((s) => s.setFlights);
  const setFetchStatus = useStore((s) => s.setFetchStatus);
  const bboxRef = useRef(bbox);
  bboxRef.current = bbox;

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let controller = null;

    async function tick() {
      const b = bboxRef.current;
      if (!b) return;
      // Non consumare quota quando la scheda è in background.
      if (typeof document !== 'undefined' && document.hidden) return;
      // In visuale frontale la simulazione è autonoma: non scarichiamo dati.
      if (useStore.getState().frontalOpen) return;
      controller = new AbortController();
      setFetchStatus('loading');
      try {
        const flights = await fetchStatesInBBox(b, controller.signal);
        if (cancelled) return;
        setFlights(flights);
        setFetchStatus('ok');
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return;
        setFetchStatus('error', err.message);
      }
    }

    tick();
    timer = setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (controller) controller.abort();
    };
  }, [intervalMs, setFlights, setFetchStatus]);
}
