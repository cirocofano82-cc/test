# FlightView ✈️

Mappa interattiva degli aerei in volo in tempo reale, con pannello dei dettagli
del volo e una **visuale frontale 3D** (Cesium) che simula la vista in fase di
decollo/atterraggio con terreno reale.

Questo è lo **scaffold base**: mappa + aerei live + dettagli + prima versione
della visuale frontale. Le fasi successive sono elencate in fondo.

## Stack

- **React + Vite**
- **React-Leaflet** — mappa 2D con i marker degli aerei (ruotati per prua)
- **OpenSky Network API** — posizioni degli aerei in tempo reale (gratuita)
- **Zustand** — stato globale (aereo selezionato, visuale aperta)
- **CesiumJS + Resium** — visuale frontale 3D su globo con terreno reale

## Avvio

```bash
npm install
npm run dev
```

Apri http://localhost:5173. Naviga sulla mappa: gli aerei nell'area visibile
vengono caricati e aggiornati ogni ~15 secondi (limite dell'accesso anonimo a
OpenSky). Clicca un aereo per aprire i dettagli, poi **"Visuale frontale 3D"**.

### Terreno realistico (consigliato)

Senza configurazione, la visuale frontale usa mappe OpenStreetMap su terreno
piatto. Per il terreno 3D e le ortofoto satellitari reali:

1. Crea un token gratuito su https://ion.cesium.com/tokens
2. `cp .env.example .env` e incolla il token in `VITE_CESIUM_ION_TOKEN`
3. Riavvia `npm run dev`

## Come funziona la visuale frontale

Non esiste un video reale della cabina: la vista è **ricostruita**. La camera di
Cesium viene posizionata alle coordinate e alla quota reali dell'aereo. Ad ogni
aggiornamento dati la camera segue l'aereo, così in avvicinamento il terreno/la
pista "cresce" e in decollo si allontana.

### Allineamento alle piste reali

Quando l'aereo è basso e vicino a un aeroporto, l'app individua la **pista reale
che sta avvicinando** e:

- disegna la pista a terra in Cesium (striscia asfalto alla larghezza reale,
  asse tratteggiato, marker di soglia con identificativo);
- **punta la camera dalla posizione dell'aereo verso la soglia pista**, con
  l'inclinazione calcolata da quota e distanza — così vedi la pista vera
  crescere in avvicinamento o allontanarsi in decollo.

Il rilevamento (`src/lib/runways.js`) considera tutte le soglie entro ~12 km e
sotto ~4000 m AGL, e sceglie l'estremità con il miglior compromesso tra
vicinanza e allineamento con la prua dell'aereo. Il pulsante **Mira: Pista /
Prua** in alto a destra alterna tra la mira sulla pista e la vista lungo la
prua dell'aereo.

I dati delle piste provengono da **[OurAirports](https://ourairports.com/data/)**
(pubblico dominio), pre-processati in `public/data/runways.json` (lat/lon,
heading true, elevazione, larghezza e lunghezza di ~13.000 piste ≥ 2500 ft).

## Struttura

```
src/
  api/opensky.js          # client REST OpenSky (bounding box)
  hooks/useFlightPolling  # polling periodico dell'area visibile
  store/useStore.js       # stato globale (zustand)
  lib/format.js           # conversioni unità + stima fase di volo
  components/
    MapView.jsx           # mappa Leaflet + marker + polling
    PlaneMarker.jsx       # icona aereo ruotata per heading
    FlightPanel.jsx       # pannello dettagli del volo
    FrontalView.jsx       # visuale frontale 3D (Cesium)
  App.jsx
```

## Vista 3D (globo)

Il pulsante **🌐 Vista 3D** in basso a destra apre una panoramica su globo
Cesium con tutti gli aerei visibili:

- **Modellini 3D** (glTF) orientati per prua, a quota reale;
- **linea al suolo** sotto ogni aereo e **scia** del percorso recente;
- **edifici 3D** (OSM Buildings) e terreno reale con il token Cesium ion;
- trascina per ruotare, rotellina per lo zoom, clic su un aereo per i dettagli.

Il modello dell'aereo è `public/models/plane.glb` (Cesium_Air, sample data
di CesiumGS).

## Roadmap (prossime fasi)

- [x] Vista 3D globo (modellini, edifici, scie, linee al suolo)
- [x] Allineare la visuale frontale alle **piste reali** (dataset OurAirports)
- [ ] Arricchire i dettagli: origine/destinazione, tipo aeromobile, compagnia
- [ ] Interpolazione fluida delle posizioni tra un update e l'altro
- [ ] Traiettoria/scia dell'aereo sulla mappa
- [ ] Filtri (quota, compagnia, in volo/a terra) e ricerca per callsign

## Rigenerare il dataset delle piste

`public/data/runways.json` è generato dal CSV di OurAirports. Per aggiornarlo:

```bash
curl -sSL -o runways.csv \
  https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv
node scripts/process-runways.mjs   # legge runways.csv, scrive public/data/runways.json
```
```
