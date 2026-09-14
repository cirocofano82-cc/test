// Client per la OpenSky Network REST API.
// Endpoint pubblico (accesso anonimo, rate-limited): /api/states/all
// Doc: https://openskynetwork.github.io/opensky-api/rest.html
//
// Ogni "state vector" è un array posizionale: mappiamo gli indici in un
// oggetto leggibile. Indici rilevanti:
//  0 icao24, 1 callsign, 2 origin_country, 5 lon, 6 lat, 7 baro_altitude,
//  8 on_ground, 9 velocity (m/s), 10 true_track (deg), 11 vertical_rate (m/s),
//  13 geo_altitude (m), 14 squawk.

const BASE = 'https://opensky-network.org/api';

function parseState(s) {
  return {
    icao24: s[0],
    callsign: (s[1] || '').trim() || null,
    originCountry: s[2],
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
    throw new Error(`OpenSky ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  const states = Array.isArray(data.states) ? data.states : [];
  return states
    .map(parseState)
    .filter((s) => s.lat != null && s.lon != null);
}
