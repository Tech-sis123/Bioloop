// Lightweight schematic map: stations are projected from lat/lng into the box.
// No map tiles or API keys needed, and it matches the BioLoop design.
export default function StationMap({ points, height = 300, onSelect, highlight }) {
  const withPos = points.filter((p) => p.lat != null && p.lng != null);
  const lats = withPos.map((p) => p.lat);
  const lngs = withPos.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const spanLat = Math.max(maxLat - minLat, 0.004);
  const spanLng = Math.max(maxLng - minLng, 0.004);
  const x = (p) => 8 + ((p.lng - minLng) / spanLng) * 84;
  const pos = (p) => ({ left: `${x(p)}%`, top: `${10 + (1 - (p.lat - minLat) / spanLat) * 80}%` });
  const labelled = highlight || withPos.find((p) => p.state === 'locked')?.id;

  return (
    <div className="map-box" style={{ minHeight: height, flex: 1 }} role="img" aria-label={`Map of ${withPos.length} stations`}>
      <div className="grid" />
      <div style={{ position: 'absolute', left: '-10%', top: '58%', width: '120%', height: 14, background: 'rgba(255,255,255,0.1)', transform: 'rotate(-12deg)' }} />
      <div style={{ position: 'absolute', left: '44%', top: '-10%', width: 14, height: '120%', background: 'rgba(255,255,255,0.1)', transform: 'rotate(8deg)' }} />
      {withPos.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`map-pin ${p.state}`}
          style={pos(p)}
          aria-label={`${p.label}: ${p.state === 'locked' ? 'locked' : p.state === 'near' ? 'near full' : p.state === 'off' ? 'offline' : 'ok'}`}
          title={p.label}
          onClick={() => onSelect?.(p)}
        />
      ))}
      {withPos.filter((p) => p.id === labelled).map((p) => (
        <span key={`l-${p.id}`} className="map-label" style={{ ...pos(p), transform: x(p) > 70 ? 'translate(calc(-100% - 12px), -50%)' : undefined }}>{p.label}</span>
      ))}
      {!withPos.length && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 14, padding: 20, textAlign: 'center' }}>
          Add latitude and longitude to stations to see them here.
        </div>
      )}
    </div>
  );
}

export function MapLegend() {
  return (
    <div className="legend">
      <span><i style={{ background: '#7CE3A3' }} />OK</span>
      <span><i style={{ background: '#FFD84D' }} />Near full</span>
      <span><i style={{ background: '#FF9A6B', boxShadow: '0 0 0 3px rgba(246,165,94,0.3)' }} />Locked</span>
      <span><i style={{ boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.6)' }} />Offline</span>
    </div>
  );
}

export function stationState(s) {
  if (s.online === false) return 'off';
  if (s.anyLocked) return 'locked';
  if (s.nearFull ?? s.compartments?.some((c) => c.fillPct >= c.nearFullThreshold)) return 'near';
  return 'ok';
}
