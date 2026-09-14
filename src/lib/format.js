// Utility di conversione/formattazione unità aeronautiche.

const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;
const MS_TO_FPM = 196.850394; // m/s -> feet/min

export const metersToFeet = (m) => (m == null ? null : m * M_TO_FT);
export const msToKnots = (ms) => (ms == null ? null : ms * MS_TO_KT);
export const msToFpm = (ms) => (ms == null ? null : ms * MS_TO_FPM);

export function fmt(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('it-IT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// Fase di volo stimata dal vertical rate e dal flag on_ground.
export function flightPhase({ onGround, verticalRate }) {
  if (onGround) return { key: 'ground', label: 'A terra' };
  if (verticalRate == null) return { key: 'cruise', label: 'Crociera' };
  if (verticalRate > 1.5) return { key: 'climb', label: 'Salita' };
  if (verticalRate < -1.5) return { key: 'descent', label: 'Discesa' };
  return { key: 'cruise', label: 'Crociera' };
}

// Punto cardinale da un heading in gradi.
export function headingToCardinal(deg) {
  if (deg == null) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(deg / 45) % 8];
}
