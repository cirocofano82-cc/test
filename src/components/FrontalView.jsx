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
    // ~4 m di altezza occhio: a terra la vista è sulla pista, non sospesa.
    alt: Math.max(camAltM, groundElevM + 4),
    heading: headingDeg,
    pitch: pitchDeg,
  };
}

// Etichette e colori (riuso classi phase-badge) per le fasi della simulazione.
const SIM_PHASE = {
  approach: { label: 'Avvicinamento', badge: 'descent' },
  rollout: { label: 'Atterraggio', badge: 'ground' },
  stopped: { label: 'Atterrato', badge: 'ground' },
  cruise: { label: 'Crociera', badge: 'cruise' },
};

// Fattore di accelerazione del tempo: a velocità reale un avvicinamento da
// alcuni km richiede minuti; così l'atterraggio si vede in ~20-30s.
const SIM_SPEEDUP = 6;

// Costruisce lo stato iniziale della simulazione da uno snapshot dell'aereo.
// Con pista: avvicinamento PARAMETRICO dal punto iniziale alla soglia
// (progressione p: 0→1); posizione e quota interpolate → atterra sempre
// esattamente sulla pista. Senza pista: crociera in linea retta.
function makeSim(snapshot, runway) {
  // La discesa/atterraggio parte solo se l'aereo è in stato "Discesa".
  if (runway && snapshot.phaseKey === 'descent') {
    const elevM = runway.thr.elevM || 0;
    let startAlt = snapshot.altM;
    if (startAlt == null || startAlt < elevM + 30) startAlt = elevM + 300;
    let speedMs = snapshot.speedMs;
    if (!speedMs || speedMs < 30) speedMs = 70; // ~135 kt di default
    const startDist = Math.max(
      haversineKm(snapshot.lat, snapshot.lon, runway.thr.lat, runway.thr.lon) *
        1000,
      300
    );
    const approachHeading = bearing(
      snapshot.lat,
      snapshot.lon,
      runway.thr.lat,
      runway.thr.lon
    );
    return {
      phase: 'approach',
      startLat: snapshot.lat,
      startLon: snapshot.lon,
      thrLat: runway.thr.lat,
      thrLon: runway.thr.lon,
      lat: snapshot.lat,
      lon: snapshot.lon,
      altM: startAlt,
      startAlt,
      elevM,
      startDist,
      p: 0,
      speedMs,
      approachHeading,
      headingT: runway.headingT ?? approachHeading,
      heading: approachHeading,
      vspeed: 0,
    };
  }
  return {
    phase: 'cruise',
    lat: snapshot.lat,
    lon: snapshot.lon,
    altM: snapshot.altM ?? 1500,
    elevM: 0,
    heading: snapshot.heading,
    speedMs: snapshot.speedMs || 120,
    vspeed: snapshot.vrate || 0,
    vrate: snapshot.vrate || 0,
  };
}

// Avanza la simulazione di dt secondi (muta l'oggetto sim).
function advanceSim(sim, dt) {
  const prevAlt = sim.altM;
  if (sim.phase === 'approach') {
    // Progressione lungo l'avvicinamento: garantisce discesa fino alla pista.
    sim.p += (sim.speedMs * dt) / sim.startDist;
    if (sim.p >= 1) {
      sim.p = 1;
      sim.lat = sim.thrLat;
      sim.lon = sim.thrLon;
      sim.altM = sim.elevM;
      sim.heading = sim.headingT;
      sim.phase = 'rollout';
    } else {
      sim.lat = sim.startLat + (sim.thrLat - sim.startLat) * sim.p;
      sim.lon = sim.startLon + (sim.thrLon - sim.startLon) * sim.p;
      sim.altM = sim.startAlt + (sim.elevM - sim.startAlt) * sim.p;
      sim.heading = sim.approachHeading;
    }
  } else if (sim.phase === 'rollout') {
    sim.heading = lerpAngleDeg(sim.heading, sim.headingT, 0.1);
    sim.speedMs = Math.max(0, sim.speedMs - 3.0 * dt); // decelerazione
    const [lat, lon] = destinationPoint(
      sim.lat,
      sim.lon,
      sim.heading,
      sim.speedMs * dt
    );
    sim.lat = lat;
    sim.lon = lon;
    sim.altM = sim.elevM;
    if (sim.speedMs < 3) sim.phase = 'stopped';
  } else if (sim.phase === 'cruise') {
    const [lat, lon] = destinationPoint(
      sim.lat,
      sim.lon,
      sim.heading,
      sim.speedMs * dt
    );
    sim.lat = lat;
    sim.lon = lon;
    sim.altM = Math.max(0, sim.altM + (sim.vrate || 0) * dt);
  }
  // 'stopped': nessun movimento.
  sim.vspeed = dt > 0 ? (sim.altM - prevAlt) / dt : 0;
}

export default function FrontalView() {
  const flight = useSelectedFlight();
  const closeFrontal = useStore((s) => s.closeFrontal);
  const frontalOpen = useStore((s) => s.frontalOpen);

  const viewerRef = useRef(null);
  const rwEntitiesRef = useRef([]);
  const [runway, setRunway] = useState(null);
  const [aimMode, setAimMode] = useState('runway'); // 'runway' | 'heading'
  const [showSynthetic, setShowSynthetic] = useState(false);
  // Valori mostrati nell'HUD, aggiornati ~5 volte/s dalla simulazione.
  const [simHud, setSimHud] = useState(null);

  const flightRef = useRef(flight); // ultimo aereo selezionato (per lo snapshot)
  const snapshotRef = useRef(null); // stato congelato all'apertura (per "Riavvia")
  const simRef = useRef(null); // simulazione in corso
  const smoothPoseRef = useRef(null); // heading/pitch mostrati (rotazione morbida)
  const lastFrameRef = useRef(0); // timestamp frame precedente (per dt)
  const lastHudRef = useRef(0); // throttle aggiornamento HUD
  const runwayRef = useRef(null);
  const aimModeRef = useRef(aimMode);
  const openRef = useRef(frontalOpen);
  // Offset di sguardo controllato dal mouse (trascinamento tasto sinistro):
  // ruota la visuale rispetto alla direzione di volo, senza fermare la sim.
  const lookRef = useRef({ yaw: 0, pitch: 0, dragging: false });
  // Zoom ottico: campo visivo (FOV) in radiani, regolato con la rotellina.
  const zoomRef = useRef({ fov: Math.PI / 3 }); // ~60° default

  useEffect(() => {
    flightRef.current = flight;
  }, [flight]);
  useEffect(() => {
    runwayRef.current = runway;
  }, [runway]);
  useEffect(() => {
    aimModeRef.current = aimMode;
  }, [aimMode]);
  useEffect(() => {
    openRef.current = frontalOpen;
  }, [frontalOpen]);

  // Setup del viewer: imagery + (se disponibile) terreno reale. Attende che
  // il viewer Cesium sia pronto prima di configurarlo.
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
      viewer.scene.globe.enableLighting = false;
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#2a2f36');
      // Nasconde il disco del sole/luna (il puntino giallo in cielo).
      if (viewer.scene.sun) viewer.scene.sun.show = false;
      if (viewer.scene.moon) viewer.scene.moon.show = false;
      (async () => {
        if (!ION_TOKEN) return;
        try {
          const terrain = await Cesium.createWorldTerrainAsync();
          if (!disposed) viewer.terrainProvider = terrain;
        } catch {
          /* resta il terreno ellissoidale di default */
        }
        try {
          const buildings = await Cesium.createOsmBuildingsAsync(); // edifici 3D
          if (!disposed) viewer.scene.primitives.add(buildings);
        } catch {
          /* niente edifici 3D */
        }
      })();

      // Attiva il ciclo di rendering SOLO quando il canvas ha una dimensione
      // reale: disegnare con larghezza 0 fa andare Cesium in errore fatale
      // ("Expected width to be greater than 0") e ferma il rendering.
      viewer.useDefaultRenderLoop = false;
      (function enableWhenSized() {
        if (disposed) return;
        const cnv = viewer.scene.canvas;
        if (cnv.clientWidth > 0 && cnv.clientHeight > 0) {
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
  }, []);

  // Controllo mouse: trascinando col tasto sinistro si ruota la visuale
  // (offset di yaw/pitch aggiunto alla posa calcolata dalla simulazione).
  // Disabilitiamo il controller di camera di Cesium: la posa la gestiamo noi.
  useEffect(() => {
    let disposed = false;
    let handler = null;
    function attach() {
      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer || !viewer.scene) {
        if (!disposed) requestAnimationFrame(attach);
        return;
      }
      const c = viewer.scene.screenSpaceCameraController;
      c.enableRotate = false;
      c.enableTranslate = false;
      c.enableZoom = false;
      c.enableTilt = false;
      c.enableLook = false;

      const SENS = 0.15; // gradi per pixel
      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction(() => {
        lookRef.current.dragging = true;
      }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
      handler.setInputAction(() => {
        lookRef.current.dragging = false;
      }, Cesium.ScreenSpaceEventType.LEFT_UP);
      handler.setInputAction((m) => {
        if (!lookRef.current.dragging) return;
        const dx = m.endPosition.x - m.startPosition.x;
        const dy = m.endPosition.y - m.startPosition.y;
        lookRef.current.yaw += dx * SENS;
        lookRef.current.pitch = Math.max(
          -70,
          Math.min(70, lookRef.current.pitch - dy * SENS)
        );
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

      // Rotellina: zoom ottico (restringe/allarga il FOV). FOV piccolo = zoom
      // in. Limiti ~12°–90°.
      handler.setInputAction((delta) => {
        const factor = delta > 0 ? 0.9 : 1.1; // su = zoom in
        zoomRef.current.fov = Math.max(
          Cesium.Math.toRadians(12),
          Math.min(Cesium.Math.toRadians(90), zoomRef.current.fov * factor)
        );
      }, Cesium.ScreenSpaceEventType.WHEEL);
    }
    attach();

    // Se il mouse viene rilasciato fuori dal canvas, esci comunque dal drag.
    const stopDrag = () => {
      lookRef.current.dragging = false;
    };
    window.addEventListener('mouseup', stopDrag);

    return () => {
      disposed = true;
      window.removeEventListener('mouseup', stopDrag);
      if (handler) handler.destroy();
    };
  }, []);

  // Avvio della simulazione: quando "salgo sull'aereo" (apertura vista),
  // congelo lo stato attuale, rilevo la pista e faccio partire la simulazione
  // autonoma. Da qui in poi NON si usano più dati reali.
  const startSim = (snapshot) => {
    smoothPoseRef.current = null;
    lookRef.current = { yaw: 0, pitch: 0, dragging: false };
    zoomRef.current = { fov: Math.PI / 3 };
    let cancelled = false;
    findApproach(snapshot.lat, snapshot.lon, snapshot.heading, snapshot.altM)
      .then((rw) => {
        if (cancelled) return;
        setRunway(rw);
        simRef.current = makeSim(snapshot, rw);
        lastFrameRef.current = performance.now();
        setSimHud({
          altM: simRef.current.altM,
          speedMs: simRef.current.speedMs,
          vspeed: 0,
          phase: simRef.current.phase,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setRunway(null);
        simRef.current = makeSim(snapshot, null);
        lastFrameRef.current = performance.now();
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!frontalOpen) {
      simRef.current = null;
      setSimHud(null);
      // Ferma il ciclo di rendering mentre la vista è nascosta.
      if (viewer) viewer.useDefaultRenderLoop = false;
      return;
    }
    if (viewer && viewer.scene.canvas.clientWidth > 0) {
      viewer.resize();
      viewer.useDefaultRenderLoop = true;
      viewer.scene.requestRender();
    }
    const f = flightRef.current;
    if (!f) return;
    const snapshot = {
      lat: f.lat,
      lon: f.lon,
      altM: f.geoAltitude ?? f.baroAltitude ?? null,
      heading: f.heading ?? 0,
      speedMs: f.velocity ?? 0,
      vrate: f.verticalRate ?? 0,
      phaseKey: flightPhase(f).key,
    };
    snapshotRef.current = snapshot;
    return startSim(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontalOpen]);

  // Riavvia la simulazione dallo snapshot iniziale.
  const restart = () => {
    if (snapshotRef.current) startSim(snapshotRef.current);
  };

  // Disegna la pista sintetica solo se attivata.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    drawRunway(viewer, rwEntitiesRef, showSynthetic ? runway : null);
  }, [runway, showSynthetic]);

  // Loop di animazione: avanza la simulazione e muove la camera ogni frame.
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
        if (!openRef.current) return;
        const sim = simRef.current;
        if (!sim) return;

        const now = performance.now();
        let dt = (now - lastFrameRef.current) / 1000;
        lastFrameRef.current = now;
        if (dt < 0) dt = 0;
        if (dt > 0.1) dt = 0.1; // evita salti dopo un frame lungo
        // In crociera (es. sorvolo di una città) niente accelerazione tempo:
        // si indugia sulla scena invece di sfrecciare via. L'accelerazione
        // serve solo a rendere veloce l'atterraggio.
        const speedup = sim.phase === 'cruise' ? 1 : SIM_SPEEDUP;
        advanceSim(sim, dt * speedup);

        // Mira: in avvicinamento verso la soglia (o prua); a terra lungo la prua.
        let aim = aimModeRef.current;
        const onGround = sim.phase === 'rollout' || sim.phase === 'stopped';
        if (onGround) aim = 'heading';
        const phaseKey = sim.phase === 'approach' ? 'descent' : 'cruise';
        const pose = computePose(
          {
            lat: sim.lat,
            lon: sim.lon,
            altM: sim.altM,
            heading: sim.heading,
            phaseKey,
          },
          runwayRef.current,
          aim
        );
        // A terra: vista quasi orizzontale lungo la pista (non inclinata in giù).
        if (onGround) pose.pitch = -2;

        // Smoothing dell'orientamento (rotazione morbida).
        let sp = smoothPoseRef.current;
        if (!sp) {
          sp = { heading: pose.heading, pitch: pose.pitch };
        } else {
          const k = 0.1;
          sp.heading = lerpAngleDeg(sp.heading, pose.heading, k);
          sp.pitch += (pose.pitch - sp.pitch) * k;
        }
        smoothPoseRef.current = sp;

        // Offset di sguardo dell'utente (mouse): ruota la visuale attorno
        // alla direzione base senza interferire col moto simulato.
        const look = lookRef.current;
        const finalHeading = sp.heading + look.yaw;
        const finalPitch = Math.max(-89, Math.min(45, sp.pitch + look.pitch));

        // Zoom ottico: applica il FOV corrente.
        if (viewer.camera.frustum && 'fov' in viewer.camera.frustum) {
          viewer.camera.frustum.fov = zoomRef.current.fov;
        }

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(pose.lon, pose.lat, pose.alt),
          orientation: {
            heading: Cesium.Math.toRadians(finalHeading),
            pitch: Cesium.Math.toRadians(finalPitch),
            roll: 0,
          },
        });

        if (now - lastHudRef.current > 200) {
          lastHudRef.current = now;
          setSimHud({
            altM: sim.altM,
            elevM: sim.elevM || 0,
            speedMs: sim.speedMs,
            vspeed: sim.vspeed,
            phase: sim.phase,
          });
        }
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

  const hasRunway = !!runway;
  const hud = simHud;
  // In simulazione mostriamo l'altezza sul suolo (AGL): a terra = 0.
  const altFt = hud
    ? fmt(metersToFeet(hud.altM - (hud.elevM || 0)))
    : flight
      ? fmt(metersToFeet(flight.geoAltitude ?? flight.baroAltitude))
      : '—';
  const spdKt = hud
    ? fmt(msToKnots(hud.speedMs))
    : flight
      ? fmt(msToKnots(flight.velocity))
      : '—';
  const vFpm = hud
    ? fmt(msToFpm(hud.vspeed))
    : flight
      ? fmt(msToFpm(flight.verticalRate))
      : '—';
  const phaseInfo = hud
    ? SIM_PHASE[hud.phase]
    : flight
      ? { label: flightPhase(flight).label, badge: flightPhase(flight).key }
      : null;

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
        <button className="btn secondary" onClick={restart} title="Riparti dallo stato iniziale">
          🔄 Riavvia
        </button>
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
          un aeroporto. Per vedere l'atterraggio scegli un aereo in{' '}
          <b>Discesa</b> a bassa quota vicino a uno scalo.
        </div>
      )}

      {flight && hasRunway && hud && hud.phase === 'cruise' && (
        <div className="frontal-note">
          Aereo non in <b>Discesa</b>: nessun atterraggio simulato. Scegli un
          aereo in fase di discesa per vedere l'avvicinamento alla pista.
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
            <div className="value">{spdKt} kt</div>
          </div>
          <div className="hud-item">
            <div className="label">Vert.</div>
            <div className="value">{vFpm} ft/min</div>
          </div>
          {phaseInfo && (
            <div className="hud-item">
              <div className="label">Fase</div>
              <div className="value">
                <span className={`phase-badge ${phaseInfo.badge}`}>
                  {phaseInfo.label}
                </span>
              </div>
            </div>
          )}
          {hasRunway && (
            <div className="hud-item runway">
              <div className="label">Pista {runway.airport}</div>
              <div className="value">
                {runway.approachIdent}
                <span className="sub"> · {runway.leIdent}/{runway.heIdent}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
