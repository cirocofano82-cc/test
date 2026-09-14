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
import { findApproach, haversineKm, bearing } from '../lib/runways';

// Token Cesium ion opzionale: con un token si abilitano terreno e
// ortofoto satellitari del mondo reale (esperienza molto più realistica).
// Senza token si usa un fallback OpenStreetMap su terreno ellissoidale.
const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;
if (ION_TOKEN) {
  Cesium.Ion.defaultAccessToken = ION_TOKEN;
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

// Imagery: OSM come base (senza chiave) sempre presente; se c'è un token
// Cesium ion aggiungiamo sopra le ortofoto satellitari del mondo reale.
// Così qualcosa è sempre visibile, anche se il token manca o non è valido.
function setupImagery(viewer) {
  viewer.imageryLayers.addImageryProvider(
    new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
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

// Calcola e applica la posa della camera.
function updateCamera(viewer, flight, runway, aimMode) {
  const phase = flightPhase(flight);
  const groundElevM = runway ? runway.thr.elevM || 0 : 0;
  // Quota della camera: quota reale dell'aereo, oppure — se assente (tipico
  // degli aerei "a terra") — poco sopra l'elevazione della pista, così la
  // vista è a livello del suolo invece che sospesa in aria.
  const rawAlt = flight.geoAltitude ?? flight.baroAltitude;
  const camAltM = rawAlt != null ? rawAlt : groundElevM + 20;

  let headingDeg = flight.heading ?? 0;
  let pitchDeg = defaultPitch(camAltM - groundElevM, phase.key);

  if (aimMode === 'runway' && runway) {
    // Punta dalla posizione reale dell'aereo verso la soglia pista.
    headingDeg = bearing(flight.lat, flight.lon, runway.thr.lat, runway.thr.lon);
    const horizM =
      haversineKm(flight.lat, flight.lon, runway.thr.lat, runway.thr.lon) * 1000;
    const aglM = Math.max(camAltM - groundElevM, 8);
    pitchDeg = (-Math.atan2(aglM, Math.max(horizM, 1)) * 180) / Math.PI;
    pitchDeg = Math.max(-60, Math.min(3, pitchDeg));
  }

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      flight.lon,
      flight.lat,
      Math.max(camAltM, groundElevM + 15)
    ),
    orientation: {
      heading: Cesium.Math.toRadians(headingDeg),
      pitch: Cesium.Math.toRadians(pitchDeg),
      roll: 0,
    },
    duration: 1.2,
  });
}

export default function FrontalView() {
  const flight = useSelectedFlight();
  const closeFrontal = useStore((s) => s.closeFrontal);
  const viewerRef = useRef(null);
  const rwEntitiesRef = useRef([]);
  const [runway, setRunway] = useState(null);
  const [aimMode, setAimMode] = useState('runway'); // 'runway' | 'heading'

  // Setup iniziale del viewer: imagery + (se disponibile) terreno reale.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    let disposed = false;

    viewer.imageryLayers.removeAll();
    setupImagery(viewer);
    // Illuminazione disattivata: con l'ombra notturna il terreno può apparire
    // scuro/uniforme. Così l'imagery è sempre a piena luminosità.
    viewer.scene.globe.enableLighting = false;
    viewer.scene.skyAtmosphere.show = true;
    // Colore di base del globo mentre i tile caricano (invece del blu oceano).
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

    return () => {
      disposed = true;
    };
  }, []);

  // Rileva la pista in avvicinamento quando cambiano i dati dell'aereo.
  useEffect(() => {
    if (!flight) return;
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
  }, [flight]);

  // Disegna/aggiorna la pista rilevata.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    drawRunway(viewer, rwEntitiesRef, runway);
  }, [runway]);

  // Aggiorna la camera al variare di aereo, pista o modalità di mira.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer || !flight) return;
    updateCamera(viewer, flight, runway, aimMode);
  }, [flight, runway, aimMode]);

  if (!flight) return null;

  const phase = flightPhase(flight);
  const altFt = fmt(metersToFeet(flight.geoAltitude ?? flight.baroAltitude));
  const hasRunway = !!runway;

  return (
    <div className="frontal">
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
      </div>

      {!hasRunway && (
        <div className="frontal-note">
          Nessuna pista nelle vicinanze: questo aereo è troppo alto o lontano da
          un aeroporto. Per vedere la pista scegli un aereo in{' '}
          <b>Salita</b> o <b>Discesa</b> a bassa quota vicino a uno scalo.
        </div>
      )}

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
    </div>
  );
}
