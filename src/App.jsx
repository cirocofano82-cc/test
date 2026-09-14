import { useEffect, useState } from 'react';
import MapView from './components/MapView';
import FlightPanel from './components/FlightPanel';
import FrontalView from './components/FrontalView';
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
  // Montiamo il viewer Cesium alla prima apertura e poi lo teniamo vivo
  // (solo nascosto quando chiuso): smontarlo/rimontarlo lo faceva ripartire
  // nero. FrontalView gestisce da sé la propria visibilità.
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (frontalOpen) setEverOpened(true);
  }, [frontalOpen]);

  return (
    <div className="app">
      <MapView />
      <TopBar />
      <FlightPanel />
      {everOpened && <FrontalView />}
    </div>
  );
}
