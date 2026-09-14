import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { Viewer } from 'resium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useStore } from '../store/useStore';

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;
const PLANE_URI = `${import.meta.env.BASE_URL}models/plane.glb`;

// Orientamento del modellino dall'heading (e pitch da salita/discesa).
// Il modello Cesium_Air ha il muso verso +X (est) a heading 0, quindi
// applichiamo un offset di -90° per allinearlo alla prua reale (0 = nord).
function planeOrientation(lon, lat, altM, headingDeg, vrate, speed) {
  const pos = Cesium.Cartesian3.fromDegrees(lon, lat, altM);
  let pitch = 0;
  if (speed && speed > 5) pitch = Math.atan2(vrate || 0, speed);
  const hpr = new Cesium.HeadingPitchRoll(
    Cesium.Math.toRadians((headingDeg ?? 0) - 90),
    pitch,
    0
  );
  return Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);
}

export default function Overview3D() {
  const overview3D = useStore((s) => s.overview3D);
  const closeOverview3D = useStore((s) => s.closeOverview3D);
  const selectFlight = useStore((s) => s.selectFlight);
  const flights = useStore((s) => s.flights);
  const history = useStore((s) => s.history);

  const viewerRef = useRef(null);
  const entitiesRef = useRef(new Map()); // icao -> { model, drop, trail }
  const openRef = useRef(overview3D);
  const framedRef = useRef(false); // camera già inquadrata all'apertura?

  useEffect(() => {
    openRef.current = overview3D;
  }, [overview3D]);

  // Setup del viewer (imagery, terreno, edifici 3D) quando è pronto.
  useEffect(() => {
    let disposed = false;
    function init() {
      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer || !viewer.scene) {
        if (!disposed) requestAnimationFrame(init);
        return;
      }
      viewer.scene.globe.enableLighting = false;
      viewer.scene.skyAtmosphere.show = true;
      if (viewer.scene.sun) viewer.scene.sun.show = false;

      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 18,
          credit: 'Imagery © Esri',
        })
      );

      (async () => {
        if (!ION_TOKEN) return;
        try {
          viewer.imageryLayers.add(Cesium.ImageryLayer.fromWorldImagery());
        } catch {
          /* resta Esri */
        }
        try {
          const t = await Cesium.createWorldTerrainAsync();
          if (!disposed) viewer.terrainProvider = t;
        } catch {
          /* terreno ellissoidale */
        }
        try {
          const b = await Cesium.createOsmBuildingsAsync(); // edifici 3D mondiali
          if (!disposed) viewer.scene.primitives.add(b);
        } catch {
          /* niente edifici 3D */
        }
      })();

      // Clic su un aereo -> selezione (apre il pannello dettagli).
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((e) => {
        const picked = viewer.scene.pick(e.position);
        const id = picked?.id?.icao24;
        if (id) selectFlight(id);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // Rendering solo con canvas dimensionato (evita crash width 0).
      viewer.useDefaultRenderLoop = false;
      (function enableWhenSized() {
        if (disposed) return;
        const c = viewer.scene.canvas;
        if (c.clientWidth > 0 && c.clientHeight > 0) {
          viewer.resize();
          viewer.useDefaultRenderLoop = openRef.current;
          viewer.scene.requestRender();
        } else {
          requestAnimationFrame(enableWhenSized);
        }
      })();
    }
    init();
    return () => {
      disposed = true;
    };
  }, [selectFlight]);

  // Pausa/ripresa del rendering all'apertura/chiusura.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    if (overview3D) {
      framedRef.current = false; // reinquadra alla prossima update
      if (viewer.scene.canvas.clientWidth > 0) {
        viewer.resize();
        viewer.useDefaultRenderLoop = true;
        viewer.scene.requestRender();
      }
    } else {
      viewer.useDefaultRenderLoop = false;
    }
  }, [overview3D]);

  // Aggiorna gli aerei (modellini + linea al suolo + scia) a ogni dato.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer || !overview3D) return;
    const map = entitiesRef.current;
    const seen = new Set();

    for (const f of flights) {
      seen.add(f.icao24);
      const altM = Math.max(f.geoAltitude ?? f.baroAltitude ?? 0, 0);
      const pos = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, altM);
      const ground = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, 0);
      const orient = planeOrientation(
        f.lon,
        f.lat,
        altM,
        f.heading,
        f.verticalRate,
        f.velocity
      );
      const trail = (history[f.icao24] || []).map((p) =>
        Cesium.Cartesian3.fromDegrees(p.lon, p.lat, Math.max(p.altM, 0))
      );

      let rec = map.get(f.icao24);
      if (!rec) {
        const model = viewer.entities.add({
          icao24: f.icao24,
          position: pos,
          orientation: orient,
          model: {
            uri: PLANE_URI,
            minimumPixelSize: 44,
            maximumScale: 20000,
            scale: 1,
            silhouetteColor: Cesium.Color.BLACK,
            silhouetteSize: 1.5,
            color: f.onGround ? Cesium.Color.LIGHTGRAY : Cesium.Color.WHITE,
          },
        });
        const drop = viewer.entities.add({
          polyline: {
            positions: [ground, pos],
            width: 1,
            material: Cesium.Color.WHITE.withAlpha(0.25),
          },
        });
        const trailEnt = viewer.entities.add({
          polyline: {
            positions: trail,
            width: 2,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.25,
              color: Cesium.Color.CYAN.withAlpha(0.7),
            }),
          },
        });
        map.set(f.icao24, { model, drop, trail: trailEnt });
      } else {
        rec.model.position = pos;
        rec.model.orientation = orient;
        rec.model.model.color = f.onGround
          ? Cesium.Color.LIGHTGRAY
          : Cesium.Color.WHITE;
        rec.drop.polyline.positions = [ground, pos];
        rec.trail.polyline.positions = trail;
      }
    }

    // Rimuove gli aerei non più presenti.
    for (const [id, rec] of map) {
      if (!seen.has(id)) {
        viewer.entities.remove(rec.model);
        viewer.entities.remove(rec.drop);
        viewer.entities.remove(rec.trail);
        map.delete(id);
      }
    }

    // Inquadra tutti gli aerei una volta all'apertura.
    if (!framedRef.current && flights.length) {
      framedRef.current = true;
      const pts = flights.map((f) =>
        Cesium.Cartesian3.fromDegrees(
          f.lon,
          f.lat,
          Math.max(f.geoAltitude ?? f.baroAltitude ?? 0, 0)
        )
      );
      const sphere = Cesium.BoundingSphere.fromPoints(pts);
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(-35),
          sphere.radius * 2.5 + 30000
        ),
      });
    }
  }, [flights, history, overview3D]);

  return (
    <div className={`overview3d ${overview3D ? '' : 'hidden'}`}>
      <Viewer
        ref={viewerRef}
        className="cesium-container"
        full={false}
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
        <button className="btn secondary" onClick={closeOverview3D}>
          ← Torna alla mappa
        </button>
      </div>
      <div className="overview3d-hint">
        Trascina per ruotare · rotellina per lo zoom · clic su un aereo per i
        dettagli
      </div>
    </div>
  );
}
