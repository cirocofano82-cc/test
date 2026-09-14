// Genera public/data/runways.json dal CSV di OurAirports.
//
// Uso:
//   curl -sSL -o runways.csv \
//     https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv
//   node scripts/process-runways.mjs [percorso-csv]
//
// Tiene solo le piste non chiuse, con coordinate valide su entrambe le
// estremità e lunghezza >= 2500 ft. Ricava l'heading true dalla geometria
// quando assente nel dataset.

import fs from 'fs';
import path from 'path';

const csvPath = process.argv[2] || 'runways.csv';
const outPath = path.join('public', 'data', 'runways.json');
const MIN_LEN_FT = 2500;

const raw = fs.readFileSync(csvPath, 'utf8');

// CSV parser robusto (campi quotati, "" come escape del doppio apice).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const norm360 = (d) => ((d % 360) + 360) % 360;

function bearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

const round = (n, d) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

const rows = parseCSV(raw);
rows.shift(); // header

const out = [];
for (const r of rows) {
  if (r.length < 20) continue;
  if (r[7] === '1') continue; // closed
  const la1 = num(r[9]);
  const lo1 = num(r[10]);
  const la2 = num(r[15]);
  const lo2 = num(r[16]);
  if (la1 == null || lo1 == null || la2 == null || lo2 == null) continue;

  const lengthFt = num(r[3]);
  if (lengthFt != null && lengthFt < MIN_LEN_FT) continue;

  let h1 = num(r[12]);
  let h2 = num(r[18]);
  if (h1 == null) h1 = bearing(la1, lo1, la2, lo2);
  if (h2 == null) h2 = bearing(la2, lo2, la1, lo1);

  out.push({
    a: r[2],
    l: r[8],
    h: r[14],
    la1: round(la1, 6),
    lo1: round(lo1, 6),
    h1: round(norm360(h1), 1),
    e1: num(r[11]),
    la2: round(la2, 6),
    lo2: round(lo2, 6),
    h2: round(norm360(h2), 1),
    e2: num(r[17]),
    w: num(r[4]),
    len: lengthFt,
  });
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const json = JSON.stringify(out);
fs.writeFileSync(outPath, json);
console.log(`piste scritte: ${out.length}`);
console.log(`dimensione: ${(json.length / 1024 / 1024).toFixed(2)} MB -> ${outPath}`);
