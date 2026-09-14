import { useEffect, useRef } from 'react';
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

// Token Cesium ion opzionale: con un token si abilitano terreno e
// ortofoto satellitari del mondo reale (esperienza molto più realistica).
// Senza token si usa un fallback OpenStreetMap su terreno ellissoidale.
const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;
if (ION_TOKEN) {
  Cesium.Ion.defaultAccessToken = ION_TOKEN;
}

// Pitch della camera (gradi) in base alla fase di volo: in avvicinamento
// guardiamo più in basso per "vedere la pista", in salita più avanti.
function cameraPitch(phaseKey) {
  switch (phaseKey) {
    case 'descent':
      return -14;
    case 'climb':
      return 3;
    case 'ground':
      return -2;
    default:
      return -8;
  }
}

async function setupImagery(viewer) {
  try {
    if (ION_TOKEN) {
      viewer.imageryLayers.add(Cesium.ImageryLayer.fromWorldImagery());
      return;
    }
  } catch {
    /* fallback sotto */
  }
  viewer.imageryLayers.addImageryProvider(
    new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
    })
  );
}

export default function FrontalView() {
  const flight = useSelectedFlight();
  const closeFrontal = useStore((s) => s.closeFrontal);
  const viewerRef = useRef(null);

  // Setup iniziale del viewer: imagery + (se disponibile) terreno reale.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    let disposed = false;

    viewer.imageryLayers.removeAll();
    setupImagery(viewer);
    viewer.scene.globe.enableLighting = true;
    viewer.scene.skyAtmosphere.show = true;

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

  // Aggiorna la camera quando cambiano i dati dell'aereo (ogni polling).
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer || !flight) return;

    const phase = flightPhase(flight);
    const alt = flight.geoAltitude ?? flight.baroAltitude ?? 300;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        flight.lon,
        flight.lat,
        Math.max(alt, 60)
      ),
      orientation: {
        heading: Cesium.Math.toRadians(flight.heading ?? 0),
        pitch: Cesium.Math.toRadians(cameraPitch(phase.key)),
        roll: 0,
      },
      duration: 1.2,
    });
  }, [flight]);

  if (!flight) return null;

  const phase = flightPhase(flight);
  const altFt = fmt(metersToFeet(flight.geoAltitude ?? flight.baroAltitude));

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
        creditContainer={undefined}
      />

      <div className="frontal-back">
        <button className="btn secondary" onClick={closeFrontal}>
          ← Torna alla mappa
        </button>
      </div>

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
      </div>
    </div>
  );
}
