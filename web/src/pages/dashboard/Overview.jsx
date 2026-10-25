import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../lib/hooks.js';
import { download } from '../../lib/api.js';
import { STREAM, duration, kg, todayLong } from '../../lib/format.js';
import Icon from '../../ui/Icon.jsx';
import { ErrorBox, Spinner, StreamTag, useToast } from '../../ui/kit.jsx';
import StationMap, { MapLegend } from '../../ui/StationMap.jsx';
import { AssignSheet, PickupStatus } from './Pickups.jsx';

export default function Overview() {
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useApi('/admin/overview', { interval: 20000 });
  const [assign, setAssign] = useState(null);

  if (!data) return error ? <ErrorBox error={error} onRetry={reload} /> : <Spinner />;

  const offline = data.stationsTotal - data.stationsOnline;
  const total = data.week.reduce((s, w) => s + w.kg, 0);
  const title = data.lockedBins
    ? `${data.lockedBins} bin${data.lockedBins > 1 ? 's are' : ' is'} locked and waiting`
    : data.nearFull ? `${data.nearFull} bin${data.nearFull > 1 ? 's are' : ' is'} close to full` : 'Every bin has room right now';
  const points = data.map.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, label: s.code, state: !s.online ? 'off' : s.anyLocked ? 'locked' : s.nearFull ? 'near' : 'ok' }));

  const exportCsv = async () => {
    try { await download('/admin/export/pickups.csv?days=30', 'bioloop-pickups-30d.csv'); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="muted" style={{ fontSize: 14 }}>{todayLong()}</p>
          <h1>{title}</h1>
        </div>
        <div className="row wrap">
          <button type="button" className="btn ghost" onClick={exportCsv}><Icon name="download" size={17} />Export report</button>
          <button type="button" className="btn" onClick={() => nav('/dashboard/pickups')}><Icon name="truck" size={17} stroke={2.2} />Dispatch pickups</button>
        </div>
      </header>
      <ErrorBox error={error} onRetry={reload} />

      <section aria-label="Key numbers" className="kpis">
        <div className="kpi">
          <div className="lbl">Stations online</div>
          <div className="val">{data.stationsOnline}<small> / {data.stationsTotal}</small></div>
          <div className="sub">{offline ? `${offline} offline, check power` : 'All reporting'}</div>
        </div>
        <div className={`kpi ${data.lockedBins ? 'warn' : ''}`}>
          <div className="lbl" style={{ color: data.lockedBins ? '#8A3409' : undefined }}>Locked (full)</div>
          <div className="val" style={{ color: data.lockedBins ? 'var(--orange)' : undefined }}>{data.lockedBins}</div>
          <div className="sub">{data.oldestLockedAt ? `Oldest waiting ${duration(data.oldestLockedAt)}` : 'None waiting'}</div>
        </div>
        <div className="kpi">
          <div className="lbl" style={{ color: 'var(--near-text)' }}>Near full</div>
          <div className="val">{data.nearFull}</div>
          <div className="sub">Likely to lock soon</div>
        </div>
        <div className="kpi">
          <div className="lbl">Pickups today</div>
          <div className="val">{data.pickupsDoneToday + data.pickupsEnRoute}</div>
          <div className="sub">{data.pickupsDoneToday} done · {data.pickupsEnRoute} en route · {data.pickupsWaiting} waiting</div>
        </div>
      </section>

      <div className="dash-grid">
        <section aria-label="Station map" className="map-card">
          <div className="row between wrap">
            <h2 style={{ fontSize: 16 }}>Live station map</h2>
            <MapLegend />
          </div>
          <StationMap points={points} onSelect={(p) => nav(`/dashboard/stations?open=${p.id}`)} />
        </section>

        <section aria-label="Needs pickup" className="card stack" style={{ minWidth: 0 }}>
          <div className="row between">
            <h2 style={{ fontSize: 16 }}>Needs pickup</h2>
            <button type="button" className="link-btn" onClick={() => nav('/dashboard/pickups')}>View all</button>
          </div>
          {!data.needsPickup.length ? <p className="small muted">Nothing waiting. New requests appear here the moment a bin gets near full.</p> : (
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Station</th><th>Stream</th><th>Fill</th><th>Collector</th><th>Status</th></tr></thead>
                <tbody>
                  {data.needsPickup.slice(0, 8).map((p) => (
                    <tr key={p.id}>
                      <td><div className="bold">{p.stationCode}</div><div className="xs muted">{p.stationName}</div></td>
                      <td><StreamTag stream={p.stream} /></td>
                      <td className="bold">{p.currentFill ?? p.fillAtRequest}%</td>
                      <td style={!p.collectorOrgName ? { color: '#8A3409', fontWeight: 600 } : undefined}>{p.collectorOrgName || 'Unassigned'}</td>
                      <td>{!p.collectorOrgId ? <button type="button" className="link-btn" onClick={() => setAssign(p)}>Assign</button> : <PickupStatus p={p} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section aria-label="Waste by stream this week" className="card stack">
        <div className="row between wrap">
          <h2 style={{ fontSize: 16 }}>Collected this week by stream</h2>
          <span className="num" style={{ fontSize: 22 }}>{total >= 1000 ? `${(total / 1000).toFixed(1)} tonnes` : kg(total)}</span>
        </div>
        <div className="stack-bar" role="img" aria-label={data.week.map((w) => `${STREAM[w.stream].label} ${total ? Math.round((w.kg / total) * 100) : 0} percent`).join(', ')}>
          {total > 0 && data.week.map((w) => <span key={w.stream} style={{ width: `${(w.kg / total) * 100}%`, background: STREAM[w.stream].color }} />)}
        </div>
        <div className="row wrap" style={{ gap: 22, fontSize: 14 }}>
          {data.week.map((w) => (
            <span key={w.stream} className="row" style={{ gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: STREAM[w.stream].color }} />
              {STREAM[w.stream].label} <strong>{total ? Math.round((w.kg / total) * 100) : 0}%</strong>
              <span className="muted">· {w.pickups} pickups{w.stream === 'recyclable' && data.recyclersServedWeek ? `, sent to ${data.recyclersServedWeek} recycler${data.recyclersServedWeek > 1 ? 's' : ''}` : ''}</span>
            </span>
          ))}
        </div>
        {!total && <p className="xs muted">Weights appear once collectors log them when marking pickups as emptied.</p>}
      </section>
      <AssignSheet pickup={assign} onClose={() => setAssign(null)} onDone={reload} />
    </>
  );
}
