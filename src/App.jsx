import { useEffect, useState } from 'react';
import MapView from './components/MapView';
import FlightPanel from './components/FlightPanel';
import FrontalView from './components/FrontalView';
import Overview3D from './components/Overview3D';
import { useStore } from './store/useStore';

function TopBar() {
  const count = useStore((s) => s.flights.length);
  const status = useStore((s) => s.fetchStatus);
  const error = useStore((s) => s.fetchError);
  const dotClass =
    status === 'loading' ? 'loading' : status === 'error' ? 'error' : '';
  return (
    <div className="topbar">
      <span className={`status-dot ${dotClass}`} />
      <h1>FlightView</h1>
      <span className="count" title={error || ''}>
        {status === 'error'
          ? `errore: ${error || 'aggiornamento'}`
          : `${count} aerei visibili`}
      </span>
    </div>
  );
}

export default function App() {
  const frontalOpen = useStore((s) => s.frontalOpen);
  const overview3D = useStore((s) => s.overview3D);
  const openOverview3D = useStore((s) => s.openOverview3D);
  // Montiamo i viewer Cesium alla prima apertura e li teniamo vivi (solo
  // nascosti quando chiusi): smontarli/rimontarli li faceva ripartire neri.
  const [everFrontal, setEverFrontal] = useState(false);
  const [everOverview, setEverOverview] = useState(false);
  useEffect(() => {
    if (frontalOpen) setEverFrontal(true);
  }, [frontalOpen]);
  useEffect(() => {
    if (overview3D) setEverOverview(true);
  }, [overview3D]);

  return (
    <div className="app">
      <MapView />
      <TopBar />
      <button
        className="map-3d-btn"
        onClick={openOverview3D}
        title="Vista 3D: globo con tutti gli aerei"
      >
        🌐 Vista 3D
      </button>
      <FlightPanel />
      {everOverview && <Overview3D />}
      {everFrontal && <FrontalView />}
    </div>
  );
}
