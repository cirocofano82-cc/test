// Client per la OpenSky Network REST API.
// Endpoint pubblico (accesso anonimo, rate-limited): /api/states/all
// Doc: https://openskynetwork.github.io/opensky-api/rest.html
//
// Ogni "state vector" è un array posizionale: mappiamo gli indici in un
// oggetto leggibile. Indici rilevanti:
//  0 icao24, 1 callsign, 2 origin_country, 5 lon, 6 lat, 7 baro_altitude,
//  8 on_ground, 9 velocity (m/s), 10 true_track (deg), 11 vertical_rate (m/s),
//  13 geo_altitude (m), 14 squawk.

// In sviluppo passiamo dal proxy Vite (/osky) per evitare problemi di CORS;
// in produzione si chiama direttamente l'API pubblica.
const BASE = import.meta.env.DEV ? '/osky' : 'https://opensky-network.org/api';

// Errore tipizzato per le risposte non-OK di OpenSky. Porta con sé lo status
// HTTP e (per il 429) i secondi di attesa suggeriti dall'header Retry-After,
// così il polling può applicare un backoff invece di martellare l'API.
export class OpenSkyError extends Error {
  constructor(status, statusText, retryAfterSec = null) {
    super(`OpenSky ${status}: ${statusText}`);
    this.name = 'OpenSkyError';
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

// Retry-After può essere un numero di secondi oppure una data HTTP.
function parseRetryAfter(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  const when = Date.parse(value);
  if (!Number.isNaN(when)) return Math.max(0, Math.round((when - Date.now()) / 1000));
  return null;
}

function parseState(s) {
  return {
    icao24: s[0],
    callsign: (s[1] || '').trim() || null,
    originCountry: s[2],
    timePosition: s[3], // unix time dell'ultimo aggiornamento di posizione
    lastContact: s[4],
    lon: s[5],
    lat: s[6],
    baroAltitude: s[7], // metri
    onGround: s[8],
    velocity: s[9], // m/s
    heading: s[10], // gradi (true track)
    verticalRate: s[11], // m/s (+ salita, - discesa)
    geoAltitude: s[13], // metri
    squawk: s[14],
  };
}

/**
 * Recupera gli aerei in un bounding box.
 * @param {{lamin:number, lomin:number, lamax:number, lomax:number}} bbox
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array>} lista di state vector normalizzati
 */
export async function fetchStatesInBBox(bbox, signal) {
  const params = new URLSearchParams({
    lamin: bbox.lamin.toFixed(4),
    lomin: bbox.lomin.toFixed(4),
    lamax: bbox.lamax.toFixed(4),
    lomax: bbox.lomax.toFixed(4),
  });
  const res = await fetch(`${BASE}/states/all?${params}`, { signal });
  if (!res.ok) {
    const retryAfter =
      res.status === 429 ? parseRetryAfter(res.headers.get('Retry-After')) : null;
    throw new OpenSkyError(res.status, res.statusText, retryAfter);
  }
  const data = await res.json();
  const states = Array.isArray(data.states) ? data.states : [];
  return states
    .map(parseState)
    .filter((s) => s.lat != null && s.lon != null);
}
