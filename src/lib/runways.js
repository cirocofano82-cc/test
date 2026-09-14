// Rilevamento della pista reale che un aereo sta avvicinando.
// Dati: OurAirports (public domain), pre-processati in /data/runways.json.
//
// Ogni record pista ha due estremità (le/he) con coordinate, heading true
// ed elevazione. "Avvicinare" un'estremità = attraversarne la soglia
// muovendosi lungo l'heading di quell'estremità.

const FT_TO_M = 0.3048;
const RADIUS_KM = 12; // raggio di ricerca soglia
const MAX_AGL_M = 4000; // sopra questa quota AGL non è avvicinamento

let cache = null;

export async function loadRunways() {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}data/runways.json`).then((r) => {
      if (!r.ok) throw new Error(`runways.json ${r.status}`);
      return r.json();
    });
  }
  return cache;
}

const toRad = (d) => (d * Math.PI) / 180;

// Distanza haversine in km.
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dφ = toRad(lat2 - lat1);
  const dλ = toRad(lon2 - lon1);
  const a =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Rotta iniziale (0..360) da 1 a 2.
export function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

// Punto di destinazione dato origine, rotta (gradi) e distanza (metri).
// Usato per estrapolare la posizione dell'aereo tra due aggiornamenti dati.
export function destinationPoint(lat, lon, bearingDeg, distanceM) {
  const R = 6371000;
  const δ = distanceM / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
  return [(φ2 * 180) / Math.PI, (((λ2 * 180) / Math.PI + 540) % 360) - 180];
}

// Differenza angolare minima 0..180.
export function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Trova la pista/estremità che l'aereo sta avvicinando.
 * @returns oggetto pista o null se nessuna rilevante nel raggio.
 */
export async function findApproach(lat, lon, headingDeg, altitudeM) {
  const runways = await loadRunways();
  const heading = headingDeg ?? 0;
  let best = null;

  for (const rw of runways) {
    // Le due estremità con la rispettiva soglia, heading ed elevazione.
    const ends = [
      { ident: rw.l, lat: rw.la1, lon: rw.lo1, hdg: rw.h1, elevFt: rw.e1 },
      { ident: rw.h, lat: rw.la2, lon: rw.lo2, hdg: rw.h2, elevFt: rw.e2 },
    ];
    for (const end of ends) {
      const dKm = haversineKm(lat, lon, end.lat, end.lon);
      if (dKm > RADIUS_KM) continue;
      const elevM = end.elevFt != null ? end.elevFt * FT_TO_M : 0;
      if (altitudeM != null && altitudeM - elevM > MAX_AGL_M) continue;

      const align = angleDiff(heading, end.hdg); // 0 = perfettamente allineato
      // Punteggio: vicinanza + penalità di disallineamento.
      const score = dKm / RADIUS_KM + align / 120;
      if (!best || score < best.score) {
        best = { rw, end, dKm, align, elevM, score };
      }
    }
  }

  if (!best) return null;
  const { rw, end, dKm, align, elevM } = best;

  return {
    airport: rw.a,
    leIdent: rw.l,
    heIdent: rw.h,
    approachIdent: end.ident,
    headingT: end.hdg,
    widthM: rw.w != null ? rw.w * FT_TO_M : 45,
    lengthM: rw.len != null ? rw.len * FT_TO_M : null,
    distanceKm: dKm,
    alignDeg: align,
    // soglia avvicinata + estremità opposta
    thr: { lat: end.lat, lon: end.lon, elevM },
    // estremità fisiche per disegnare la striscia
    a1: { lat: rw.la1, lon: rw.lo1 },
    a2: { lat: rw.la2, lon: rw.lo2 },
  };
}
