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

  return (
    <div className="app">
      <MapView />
      <TopBar />
      <FlightPanel />
      {frontalOpen && <FrontalView />}
    </div>
  );
}
