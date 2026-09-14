import { useStore, useSelectedFlight } from '../store/useStore';
import {
  metersToFeet,
  msToKnots,
  msToFpm,
  fmt,
  flightPhase,
  headingToCardinal,
} from '../lib/format';

function Stat({ label, value, unit }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

export default function FlightPanel() {
  const flight = useSelectedFlight();
  const clearSelection = useStore((s) => s.clearSelection);
  const openFrontal = useStore((s) => s.openFrontal);

  if (!flight) return null;

  const phase = flightPhase(flight);

  return (
    <aside className="panel">
      <div className="panel-header">
        <div>
          <div className="callsign">{flight.callsign || flight.icao24}</div>
          <div className="country">{flight.originCountry}</div>
        </div>
        <button className="close-btn" onClick={clearSelection} aria-label="Chiudi">
          ×
        </button>
      </div>

      <div className="panel-body">
        <div style={{ marginBottom: 12 }}>
          <span className={`phase-badge ${phase.key}`}>{phase.label}</span>
        </div>

        <div className="stat-grid">
          <Stat
            label="Quota"
            value={fmt(metersToFeet(flight.geoAltitude ?? flight.baroAltitude))}
            unit="ft"
          />
          <Stat label="Velocità" value={fmt(msToKnots(flight.velocity))} unit="kt" />
          <Stat
            label="Rateo vert."
            value={fmt(msToFpm(flight.verticalRate))}
            unit="ft/min"
          />
          <Stat
            label="Prua"
            value={`${fmt(flight.heading)}° ${headingToCardinal(flight.heading)}`}
          />
          <Stat label="Lat" value={fmt(flight.lat, 3)} />
          <Stat label="Lon" value={fmt(flight.lon, 3)} />
          <Stat label="ICAO24" value={flight.icao24} />
          <Stat label="Squawk" value={flight.squawk || '—'} />
        </div>

        <p className="hint">
          I dati provengono da OpenSky Network e si aggiornano ogni ~15s. Alcuni
          campi possono essere assenti a seconda della copertura dei ricevitori.
        </p>
      </div>

      <div className="panel-footer">
        <button className="btn" onClick={openFrontal} disabled={flight.onGround && false}>
          ✈ Visuale frontale 3D
        </button>
      </div>
    </aside>
  );
}
