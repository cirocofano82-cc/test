import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { Viewer } from 'resium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useStore, useSelectedFlight } from '../store/useStore';
import {
  metersToFeet,
  msToKnots,
  msToFpm,
  fmt,
  flightPhase,
} from '../lib/format';
import {
  findApproach,
  haversineKm,
  bearing,
  destinationPoint,
} from '../lib/runways';

// Token Cesium ion opzionale: con un token si abilitano terreno e
// ortofoto satellitari del mondo reale (esperienza molto più realistica).
// Senza token si usa un fallback OpenStreetMap su terreno ellissoidale.
const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;
if (ION_TOKEN) {
  Cesium.Ion.defaultAccessToken = ION_TOKEN;
}

// Interpolazione tra due angoli in gradi lungo il cammino più breve
// (gestisce il passaggio 359°→1° senza giri completi).
function lerpAngleDeg(a, b, k) {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * k;
}

// Pitch della camera (gradi) quando NON puntiamo una pista specifica.
// Più l'aereo è alto, più guardiamo verso il basso per tenere il terreno in
// vista invece dell'orizzonte vuoto (a bassa quota resta quasi orizzontale).
function defaultPitch(altM, phaseKey) {
  const base = Math.min(35, 8 + (altM ?? 300) / 400); // ~ -9° a terra, -34° in crociera
  let p = -base;
  if (phaseKey === 'climb') p += 6; // in salita guarda un po' più avanti
  return Math.max(-45, Math.min(-5, p));
}

// Imagery: base satellitare Esri (senza chiave, con CORS affidabile) sempre
// presente — mostra gli aeroporti/piste reali dall'alto. Se c'è un token
// Cesium ion aggiungiamo sopra le sue ortofoto (di solito più dettagliate).
// Così qualcosa è sempre visibile anche senza token o con token non valido.
function setupImagery(viewer) {
  viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 18,
      credit: 'Imagery © Esri',
    })
  );
  if (ION_TOKEN) {
    try {
      viewer.imageryLayers.add(Cesium.ImageryLayer.fromWorldImagery());
    } catch (e) {
      console.warn('[FlightView] World imagery non disponibile:', e);
    }
  }
}

// Disegna la pista reale (striscia + asse + soglia) sostituendo la precedente.
function drawRunway(viewer, entitiesRef, runway) {
  entitiesRef.current.forEach((e) => viewer.entities.remove(e));
  entitiesRef.current = [];
  if (!runway) return;

  const p1 = Cesium.Cartesian3.fromDegrees(runway.a1.lon, runway.a1.lat);
  const p2 = Cesium.Cartesian3.fromDegrees(runway.a2.lon, runway.a2.lat);

  const strip = viewer.entities.add({
    corridor: {
      positions: [p1, p2],
      width: runway.widthM || 45,
      material: Cesium.Color.fromCssColorString('#23262d'),
      cornerType: Cesium.CornerType.MITERED,
      clampToGround: true,
    },
  });

  const centerline = viewer.entities.add({
    polyline: {
      positions: [p1, p2],
      width: 2,
      clampToGround: true,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.WHITE.withAlpha(0.85),
        dashLength: 22,
      }),
    },
  });

  const thr = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(runway.thr.lon, runway.thr.lat),
    point: {
      pixelSize: 10,
      color: Cesium.Color.fromCssColorString('#2bd4a7'),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    label: {
      text: `RWY ${runway.approachIdent}`,
      font: 'bold 14px system-ui, sans-serif',
      pixelOffset: new Cesium.Cartesian2(0, -18),
      fillColor: Cesium.Color.WHITE,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 3,
      outlineColor: Cesium.Color.BLACK,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  entitiesRef.current = [strip, centerline, thr];
}

// Calcola la posa della camera per uno stato (posizione/quota/prua) dato.
// Funzione pura: la usa il loop di animazione a ogni frame.
function computePose(state, runway, aimMode) {
  const groundElevM = runway ? runway.thr.elevM || 0 : 0;
  const camAltM = state.altM != null ? state.altM : groundElevM + 20;

  let headingDeg = state.heading ?? 0;
  let pitchDeg = defaultPitch(camAltM - groundElevM, state.phaseKey);

  if (aimMode === 'runway' && runway) {
    // Punta dalla posizione (estrapolata) dell'aereo verso la soglia pista.
    headingDeg = bearing(state.lat, state.lon, runway.thr.lat, runway.thr.lon);
    const horizM =
      haversineKm(state.lat, state.lon, runway.thr.lat, runway.thr.lon) * 1000;
    const aglM = Math.max(camAltM - groundElevM, 8);
    pitchDeg = (-Math.atan2(aglM, Math.max(horizM, 1)) * 180) / Math.PI;
    pitchDeg = Math.max(-60, Math.min(3, pitchDeg));
  }

  return {
    lon: state.lon,
    lat: state.lat,
    alt: Math.max(camAltM, groundElevM + 15),
    heading: headingDeg,
    pitch: pitchDeg,
  };
}

export default function FrontalView() {
  const flight = useSelectedFlight();
  const closeFrontal = useStore((s) => s.closeFrontal);
  const viewerRef = useRef(null);
  const rwEntitiesRef = useRef([]);
  const [runway, setRunway] = useState(null);
  const [aimMode, setAimMode] = useState('runway'); // 'runway' | 'heading'
  // Pista "sintetica" (striscia disegnata) disattivata di default: così si
  // vede la pista reale del satellite. Attivabile col toggle.
  const [showSynthetic, setShowSynthetic] = useState(false);

  // Refs letti dal loop di animazione (per avere sempre i valori aggiornati
  // senza ri-registrare il listener a ogni cambio).
  const frontalOpen = useStore((s) => s.frontalOpen);

  const baseRef = useRef(null); // stato dell'ultimo dato reale + timestamp
  const smoothRef = useRef(null); // posizione mostrata, per correzione morbida
  const smoothPoseRef = useRef(null); // heading/pitch mostrati, per rotazione morbida
  const runwayRef = useRef(null);
  const aimModeRef = useRef(aimMode);
  const openRef = useRef(frontalOpen);
  useEffect(() => {
    runwayRef.current = runway;
  }, [runway]);
  useEffect(() => {
    aimModeRef.current = aimMode;
  }, [aimMode]);
  useEffect(() => {
    openRef.current = frontalOpen;
  }, [frontalOpen]);

  // Alla riapertura: ridimensiona il viewer (l'elemento era nascosto) e
  // azzera lo smoothing così la vista si aggancia subito all'aereo corrente.
  useEffect(() => {
    if (!frontalOpen) return;
    smoothRef.current = null;
    smoothPoseRef.current = null;
    const viewer = viewerRef.current?.cesiumElement;
    if (viewer) {
      viewer.resize();
      viewer.scene.requestRender();
    }
  }, [frontalOpen]);

  // A ogni nuovo dato reale aggiorna la "base" da cui estrapolare il moto.
  // Se il dato è identico al precedente (OpenSky a volte ripete lo stesso
  // state vector tra due poll), NON resettiamo: continuiamo a estrapolare
  // senza far tornare indietro la camera.
  useEffect(() => {
    if (!flight) {
      baseRef.current = null;
      smoothRef.current = null;
      return;
    }
    const prev = baseRef.current;
    const unchanged =
      prev &&
      prev.lat === flight.lat &&
      prev.lon === flight.lon &&
      prev.timePos === (flight.timePosition ?? null);
    if (unchanged) return;

    // Cambio aereo o salto grande: azzera lo smoothing per non "planare"
    // attraverso la mappa da una posizione all'altra.
    if (prev && haversineKm(prev.lat, prev.lon, flight.lat, flight.lon) > 3) {
      smoothRef.current = null;
    }

    baseRef.current = {
      lat: flight.lat,
      lon: flight.lon,
      altM: flight.geoAltitude ?? flight.baroAltitude ?? null,
      heading: flight.heading ?? 0,
      vMs: flight.velocity ?? 0, // m/s
      vrate: flight.verticalRate ?? 0, // m/s
      phaseKey: flightPhase(flight).key,
      timePos: flight.timePosition ?? null,
      t0: performance.now(),
    };
  }, [flight]);

  // Setup iniziale del viewer: imagery + (se disponibile) terreno reale.
  // Attende che il viewer Cesium sia pronto (il ref può non esserlo al primo
  // giro di effect) prima di configurare l'imagery.
  useEffect(() => {
    let disposed = false;

    function init() {
      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer || !viewer.scene) {
        if (!disposed) requestAnimationFrame(init);
        return;
      }

      viewer.imageryLayers.removeAll();
      setupImagery(viewer);
      // Illuminazione disattivata: con l'ombra notturna il terreno può
      // apparire scuro/uniforme. Così l'imagery è sempre a piena luminosità.
      viewer.scene.globe.enableLighting = false;
      viewer.scene.skyAtmosphere.show = true;
      // Colore di base del globo mentre i tile caricano (non blu oceano).
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#2a2f36');

      (async () => {
        if (!ION_TOKEN) return;
        try {
          const terrain = await Cesium.createWorldTerrainAsync();
          if (!disposed) viewer.terrainProvider = terrain;
        } catch {
          /* resta il terreno ellissoidale di default */
        }
      })();
    }

    init();
    return () => {
      disposed = true;
    };
  }, []);

  // Rileva la pista in avvicinamento quando cambiano i dati dell'aereo
  // (solo a vista aperta, per non lavorare inutilmente quando è nascosta).
  useEffect(() => {
    if (!flight || !frontalOpen) return;
    let cancelled = false;
    const altM = flight.geoAltitude ?? flight.baroAltitude ?? null;
    findApproach(flight.lat, flight.lon, flight.heading, altM)
      .then((r) => {
        if (!cancelled) setRunway(r);
      })
      .catch(() => {
        if (!cancelled) setRunway(null);
      });
    return () => {
      cancelled = true;
    };
  }, [flight, frontalOpen]);

  // Disegna la pista sintetica solo se attivata; altrimenti resta la pista
  // reale del satellite, senza sovrapposizioni.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    drawRunway(viewer, rwEntitiesRef, showSynthetic ? runway : null);
  }, [runway, showSynthetic]);

  // Loop di animazione: a ogni frame estrapola la posizione dell'aereo dal
  // suo ultimo dato reale (dead reckoning con velocità e prua) e muove la
  // camera. Così la scena è fluida invece di aggiornarsi a scatti ogni ~15s.
  useEffect(() => {
    let disposed = false;
    let remove = null;

    function attach() {
      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer || !viewer.scene) {
        if (!disposed) requestAnimationFrame(attach);
        return;
      }
      const onFrame = () => {
        if (!openRef.current) return; // fermo mentre la vista è nascosta
        const base = baseRef.current;
        if (!base) return;
        // Cap a 25s: se i dati si fermano, la camera non "vola via".
        const elapsed = Math.min((performance.now() - base.t0) / 1000, 25);
        const distM = (base.vMs || 0) * elapsed;
        const [lat, lon] = destinationPoint(
          base.lat,
          base.lon,
          base.heading,
          distM
        );
        const altM =
          base.altM != null ? base.altM + (base.vrate || 0) * elapsed : null;

        // Correzione morbida: la posizione mostrata insegue quella target,
        // così un riallineamento dei dati non produce uno scatto secco.
        let s = smoothRef.current;
        if (!s) {
          s = { lat, lon, altM };
        } else {
          const k = 0.12;
          s.lat += (lat - s.lat) * k;
          s.lon += (lon - s.lon) * k;
          s.altM =
            altM == null ? null : s.altM == null ? altM : s.altM + (altM - s.altM) * k;
        }
        smoothRef.current = s;

        const pose = computePose(
          {
            lat: s.lat,
            lon: s.lon,
            altM: s.altM,
            heading: base.heading,
            phaseKey: base.phaseKey,
          },
          runwayRef.current,
          aimModeRef.current
        );

        // Smoothing anche dell'orientamento: heading/pitch inseguono i valori
        // target, così un cambio di prua a un nuovo dato non fa ruotare di
        // scatto la camera.
        let sp = smoothPoseRef.current;
        if (!sp) {
          sp = { heading: pose.heading, pitch: pose.pitch };
        } else {
          const k = 0.1;
          sp.heading = lerpAngleDeg(sp.heading, pose.heading, k);
          sp.pitch += (pose.pitch - sp.pitch) * k;
        }
        smoothPoseRef.current = sp;

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            pose.lon,
            pose.lat,
            pose.alt
          ),
          orientation: {
            heading: Cesium.Math.toRadians(sp.heading),
            pitch: Cesium.Math.toRadians(sp.pitch),
            roll: 0,
          },
        });
      };
      viewer.scene.preRender.addEventListener(onFrame);
      remove = () => viewer.scene.preRender.removeEventListener(onFrame);
    }

    attach();
    return () => {
      disposed = true;
      if (remove) remove();
    };
  }, []);

  // Il viewer resta sempre montato (solo nascosto quando chiuso) per non
  // rimontare Cesium, che ripartiva nero. Gli overlay dipendono dal volo.
  const phase = flight ? flightPhase(flight) : null;
  const altFt = flight
    ? fmt(metersToFeet(flight.geoAltitude ?? flight.baroAltitude))
    : '—';
  const hasRunway = !!runway;

  return (
    <div className={`frontal ${frontalOpen ? '' : 'hidden'}`}>
      <Viewer
        ref={viewerRef}
        className="cesium-container"
        full={false}
        baseLayer={false}
        baseLayerPicker={false}
        geocoder={false}
        homeButton={false}
        sceneModePicker={false}
        navigationHelpButton={false}
        animation={false}
        timeline={false}
        fullscreenButton={false}
        infoBox={false}
        selectionIndicator={false}
      />

      <div className="frontal-back">
        <button className="btn secondary" onClick={closeFrontal}>
          ← Torna alla mappa
        </button>
      </div>

      <div className="frontal-topright">
        <button
          className={`btn ${aimMode === 'runway' ? '' : 'secondary'}`}
          disabled={!hasRunway}
          onClick={() =>
            setAimMode((m) => (m === 'runway' ? 'heading' : 'runway'))
          }
          title={
            hasRunway
              ? 'Alterna tra mira sulla pista e vista lungo la prua'
              : 'Nessuna pista rilevata nelle vicinanze'
          }
        >
          {aimMode === 'runway' && hasRunway ? '🎯 Mira: Pista' : '🧭 Mira: Prua'}
        </button>
        <button
          className={`btn ${showSynthetic ? '' : 'secondary'}`}
          disabled={!hasRunway}
          onClick={() => setShowSynthetic((v) => !v)}
          title="Mostra/nasconde la pista disegnata sopra quella reale"
        >
          {showSynthetic ? '▦ Pista 3D: ON' : '▦ Pista 3D: OFF'}
        </button>
      </div>

      {flight && !hasRunway && (
        <div className="frontal-note">
          Nessuna pista nelle vicinanze: questo aereo è troppo alto o lontano da
          un aeroporto. Per vedere la pista scegli un aereo in{' '}
          <b>Salita</b> o <b>Discesa</b> a bassa quota vicino a uno scalo.
        </div>
      )}

      {flight && (
      <div className="frontal-hud">
        <div className="hud-item">
          <div className="label">Volo</div>
          <div className="value">{flight.callsign || flight.icao24}</div>
        </div>
        <div className="hud-item">
          <div className="label">Quota</div>
          <div className="value">{altFt} ft</div>
        </div>
        <div className="hud-item">
          <div className="label">Velocità</div>
          <div className="value">{fmt(msToKnots(flight.velocity))} kt</div>
        </div>
        <div className="hud-item">
          <div className="label">Vert.</div>
          <div className="value">{fmt(msToFpm(flight.verticalRate))} ft/min</div>
        </div>
        <div className="hud-item">
          <div className="label">Fase</div>
          <div className="value">
            <span className={`phase-badge ${phase.key}`}>{phase.label}</span>
          </div>
        </div>
        {hasRunway && (
          <div className="hud-item runway">
            <div className="label">Pista {runway.airport}</div>
            <div className="value">
              {runway.approachIdent} · {fmt(runway.distanceKm, 1)} km
              <span className="sub"> · allin. {fmt(runway.alignDeg)}°</span>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
