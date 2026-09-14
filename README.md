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
Cesium viene posizionata alle coordinate e alla quota reali dell'aereo,
orientata lungo la prua (`heading`) con un'inclinazione verso il basso che
dipende dalla fase di volo (più in basso in discesa/avvicinamento, in avanti in
salita). Ad ogni aggiornamento dati la camera segue l'aereo, così in
avvicinamento il terreno/la pista "cresce" e in decollo si allontana.

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

## Roadmap (prossime fasi)

- [ ] Arricchire i dettagli: origine/destinazione, tipo aeromobile, compagnia
- [ ] Allineare la visuale frontale alle **piste reali** (dataset OurAirports:
      lat/lon/heading/lunghezza) per un avvicinamento accurato
- [ ] Interpolazione fluida delle posizioni tra un update e l'altro
- [ ] Traiettoria/scia dell'aereo sulla mappa
- [ ] Filtri (quota, compagnia, in volo/a terra) e ricerca per callsign
```
