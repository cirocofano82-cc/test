import { useState, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import PlaneMarker from './PlaneMarker';
import { useFlightPolling } from '../hooks/useFlightPolling';
import { useStore } from '../store/useStore';

// Converte i bounds di Leaflet nel formato bbox di OpenSky.
function boundsToBBox(b) {
  return {
    lamin: b.getSouth(),
    lomin: b.getWest(),
    lamax: b.getNorth(),
    lomax: b.getEast(),
  };
}

// Osserva i movimenti/zoom della mappa e riporta il bbox al parent.
function BoundsWatcher({ onChange }) {
  const map = useMap();
  useEffect(() => {
    onChange(boundsToBBox(map.getBounds()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useMapEvents({
    moveend: () => onChange(boundsToBBox(map.getBounds())),
    zoomend: () => onChange(boundsToBBox(map.getBounds())),
  });
  return null;
}

function FlightMarkers() {
  const flights = useStore((s) => s.flights);
  const selectedId = useStore((s) => s.selectedId);
  const selectFlight = useStore((s) => s.selectFlight);
  return flights.map((f) => (
    <PlaneMarker
      key={f.icao24}
      flight={f}
      selected={f.icao24 === selectedId}
      onSelect={selectFlight}
    />
  ));
}

// Avvia il polling in base al bbox corrente (montato dentro la mappa
// così da poter cambiare quando l'utente naviga).
function Poller({ bbox }) {
  useFlightPolling(bbox, 15000);
  return null;
}

export default function MapView() {
  const [bbox, setBbox] = useState(null);
  const handleBounds = useCallback((b) => setBbox(b), []);

  return (
    <MapContainer
      className="map-full"
      center={[45.46, 9.19]} // Milano
      zoom={7}
      zoomControl={false}
      worldCopyJump
    >
      <TileLayer
        attribution="Tiles &copy; Esri — Esri, DeLorme, NAVTEQ"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        maxZoom={16}
      />
      <BoundsWatcher onChange={handleBounds} />
      {bbox && <Poller bbox={bbox} />}
      <FlightMarkers />
    </MapContainer>
  );
}
