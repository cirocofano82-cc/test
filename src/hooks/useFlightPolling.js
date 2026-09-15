import { useEffect, useRef } from 'react';
import { fetchStatesInBBox } from '../api/opensky';
import { useStore } from '../store/useStore';

// Tetto massimo del backoff: oltre non ha senso salire, l'utente resterebbe
// troppo a lungo senza aggiornamenti.
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minuti

// Effettua il polling degli aerei nel bounding box corrente.
// L'accesso anonimo a OpenSky è fortemente rate-limited: in caso di errore
// (in particolare 429 Too Many Requests) applichiamo un backoff esponenziale
// invece di continuare a martellare l'API allo stesso ritmo, il che non farebbe
// che prolungare il blocco. A ogni richiesta andata a buon fine torniamo alla
// cadenza normale (intervalMs, default 15s).
export function useFlightPolling(bbox, intervalMs = 15000) {
  const setFlights = useStore((s) => s.setFlights);
  const setFetchStatus = useStore((s) => s.setFetchStatus);
  const bboxRef = useRef(bbox);
  bboxRef.current = bbox;

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let controller = null;
    // Ritardo corrente dopo un errore; parte da intervalMs e raddoppia.
    let backoffMs = intervalMs;

    function schedule(delay) {
      if (cancelled) return;
      timer = setTimeout(tick, delay);
    }

    async function tick() {
      const b = bboxRef.current;
      // Salta questo giro ma continua il ciclo: rimandiamo alla cadenza base.
      if (
        !b ||
        (typeof document !== 'undefined' && document.hidden) ||
        // In visuale frontale la simulazione è autonoma: non scarichiamo dati.
        useStore.getState().frontalOpen
      ) {
        schedule(intervalMs);
        return;
      }

      controller = new AbortController();
      setFetchStatus('loading');
      try {
        const flights = await fetchStatesInBBox(b, controller.signal);
        if (cancelled) return;
        setFlights(flights);
        setFetchStatus('ok');
        backoffMs = intervalMs; // ripristina la cadenza normale
        schedule(intervalMs);
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return;

        let waitMs;
        if (err.status === 429) {
          // Rispetta Retry-After se presente, altrimenti backoff esponenziale.
          const retryMs = err.retryAfterSec != null ? err.retryAfterSec * 1000 : 0;
          waitMs = Math.min(Math.max(retryMs, backoffMs), MAX_BACKOFF_MS);
          const secs = Math.ceil(waitMs / 1000);
          setFetchStatus(
            'error',
            `Troppe richieste a OpenSky (429): nuovo tentativo tra ${secs}s`,
          );
        } else {
          waitMs = Math.min(backoffMs, MAX_BACKOFF_MS);
          setFetchStatus('error', err.message);
        }
        // Raddoppia il backoff per il prossimo eventuale errore (cap incluso).
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        schedule(waitMs);
      }
    }

    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (controller) controller.abort();
    };
  }, [intervalMs, setFlights, setFetchStatus]);
}
