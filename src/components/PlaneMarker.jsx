import { Marker } from 'react-leaflet';
import L from 'leaflet';

// Icona aereo come SVG in un divIcon, ruotata secondo l'heading.
// Il triangolo/silhouette punta verso l'alto a 0°, quindi ruotiamo di `heading`.
function planeDivIcon(heading, { selected, onGround }) {
  const cls = [
    'plane-icon',
    selected ? 'selected' : '',
    onGround ? 'on-ground' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const rot = heading ?? 0;
  const svg = `
    <div class="${cls}" style="transform: rotate(${rot}deg);">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"
           xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2 L14 8 L22 12 L22 14 L14 12.5 L13.5 19 L16 21 L16 22
                 L12 20.8 L8 22 L8 21 L10.5 19 L10 12.5 L2 14 L2 12 L10 8 Z"/>
      </svg>
    </div>`;
  return L.divIcon({
    html: svg,
    className: 'plane-div-icon',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export default function PlaneMarker({ flight, selected, onSelect }) {
  return (
    <Marker
      position={[flight.lat, flight.lon]}
      icon={planeDivIcon(flight.heading, {
        selected,
        onGround: flight.onGround,
      })}
      eventHandlers={{ click: () => onSelect(flight.icao24) }}
      zIndexOffset={selected ? 1000 : 0}
    />
  );
}
