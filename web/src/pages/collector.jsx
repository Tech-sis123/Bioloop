import { useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/hooks.js';
import { post } from '../lib/api.js';
import { STREAM, ago, timeOf } from '../lib/format.js';
import Icon from '../ui/Icon.jsx';
import { AlertsButton, Bar, Empty, ErrorBox, Field, Sheet, Spinner, StreamSwatch, useForm, useToast, useUnread } from '../ui/kit.jsx';
import StationMap, { MapLegend, stationState } from '../ui/StationMap.jsx';

function useCollectorData() {
  const pickups = useApi('/pickups', { interval: 20000 });
  const stations = useApi('/stations?mine=1', { interval: 30000 });
  const summary = useApi('/pickups/summary', { interval: 30000 });
  const byId = useMemo(() => Object.fromEntries((stations.data?.stations || []).map((s) => [s.id, s])), [stations.data]);
  const reload = () => { pickups.reload(); stations.reload(); summary.reload(); };
  return { pickups, stations, summary, byId, reload };
}

// Group open pickups by station so one stop can cover several compartments
function groupStops(pickups) {
  const map = new Map();
  for (const p of pickups) {
    if (!map.has(p.stationId)) map.set(p.stationId, { stationId: p.stationId, code: p.stationCode, name: p.stationName, area: p.stationArea, lat: p.lat, lng: p.lng, items: [] });
    map.get(p.stationId).items.push(p);
  }
  return [...map.values()];
}

export function CollectorRoute() {
  const { user } = useAuth();
  const unread = useUnread();
  const toast = useToast();
  const { pickups, byId, summary, reload } = useCollectorData();
  const [stop, setStop] = useState(null);
  const [busy, setBusy] = useState(false);
  const stops = useMemo(() => groupStops(pickups.data?.pickups || []), [pickups.data]);
  const assigned = (pickups.data?.pickups || []).filter((p) => p.status === 'assigned').length;
  const enRoute = (pickups.data?.pickups || []).some((p) => p.status === 'en_route');

  const startRoute = async () => {
    setBusy(true);
    try {
      const r = await post('/pickups/start-route');
      toast(r.started ? `Route started. ${r.started} pickup${r.started > 1 ? 's' : ''} now on the way.` : 'Nothing new to start.');
      reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <>
      <header className="topbar">
        <div className="grow">
          <p className="small muted truncate">{user.orgName || 'No company linked'} · Collector</p>
          <h1 className="page-title md" style={{ marginTop: 2 }}>Today's route</h1>
        </div>
        <span className={`pill ${enRoute ? 'ok' : 'grey'}`}>{enRoute ? 'On route' : 'Ready'}</span>
        <AlertsButton unread={unread} />
      </header>
      <main className="page cols" style={{ gap: 12 }}>
        <div className="col">
        {!user.orgId && <div className="notice">Your account is not linked to a collection company yet. Ask your BioLoop admin to add you.</div>}
        <ErrorBox error={pickups.error} onRetry={reload} />

        <section aria-label="Route overview" className="route-card">
          <RouteSketch stops={stops} />
          <div className="route-stats">
            <div><div className="num">{summary.data?.open ?? '–'}</div><div className="lbl">Stops</div></div>
            <div><div className="num" style={{ color: '#FFB38F' }}>{summary.data?.locked ?? '–'}</div><div className="lbl">Locked bins</div></div>
            <div><div className="num">{summary.data?.doneToday ?? '–'}</div><div className="lbl">Done today</div></div>
          </div>
        </section>
        {assigned > 0 && (
          <button type="button" className="btn big block pink" onClick={startRoute} disabled={busy}>
            <Icon name="nav" size={20} stroke={2.2} />Start route ({assigned})
          </button>
        )}
        </div>

        <div className="col">
        <div className="row between" style={{ marginTop: 2 }}>
          <h2 className="section-title">Next stops</h2>
          <span className="small muted">Sorted by urgency</span>
        </div>

        {!pickups.data ? <Spinner /> : !stops.length ? (
          <Empty icon="check" title="All clear">No bins need pickup right now. New requests show up here automatically.</Empty>
        ) : stops.map((s, i) => {
          const st = byId[s.stationId];
          const locked = s.items.some((p) => p.locked);
          const top = s.items.reduce((m, p) => ((p.currentFill ?? 0) > (m.currentFill ?? 0) ? p : m), s.items[0]);
          return (
            <button type="button" key={s.stationId} onClick={() => setStop(s)} className={`card tight stack ${locked ? 'warn' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', gap: 10 }}>
              <div className="row" style={{ gap: 12 }}>
                <span className={`stop-num ${i === 0 ? 'first' : ''}`}>{i + 1}</span>
                <div className="grow">
                  <div style={{ fontSize: 15, fontWeight: 700 }} className="truncate">{s.code} · {s.name}</div>
                  <div className="small muted truncate">{s.area}{i > 0 ? ` · ${STREAM[top.stream].label} ${top.currentFill ?? '?'}%` : ''}</div>
                </div>
                {s.items.some((p) => p.status === 'en_route')
                  ? <span className="pill ok">On the way</span>
                  : locked ? <span className="pill locked">Locked</span> : <span className="pill near">Near full</span>}
              </div>
              {i === 0 && st && (
                <div className="choice-grid" style={{ gap: 6 }}>
                  {st.compartments.map((c) => (
                    <div key={c.stream}>
                      <Bar thin value={c.fillPct} color={STREAM[c.stream].color} />
                      <div className="xs" style={{ marginTop: 4, color: c.locked ? 'var(--ink)' : 'var(--muted)', fontWeight: c.locked ? 700 : 400 }}>{STREAM[c.stream].label} {c.fillPct}%</div>
                    </div>
                  ))}
                </div>
              )}
            </button>
          );
        })}
        </div>
      </main>
      <StopSheet stop={stop} station={stop && byId[stop.stationId]} onClose={() => setStop(null)} onChanged={() => { reload(); }} />
    </>
  );
}

function RouteSketch({ stops }) {
  // Draw the first 5 stops as a dotted path in the header card
  const pts = stops.slice(0, 5);
  const coords = pts.map((_, i) => [pts.length === 1 ? 200 : 100 + (i * 220) / (pts.length - 1), i % 2 ? 98 : 50 - i * 4]);
  const d = coords.length ? `M40 120 ${coords.map(([x, y]) => `L${x} ${y}`).join(' ')}` : '';
  return (
    <div className="route-map">
      <svg width="100%" height="150" viewBox="0 0 350 150" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 40 H350 M0 100 H350 M70 0 V150 M180 0 V150 M280 0 V150" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
        {d && <path d={d} fill="none" stroke="#7CE3A3" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 9" />}
        <circle cx="40" cy="120" r="9" fill="#FFFFFF" />
        <circle cx="40" cy="120" r="4" fill="#13265E" />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={pts[i].items.some((p) => p.locked) ? 8 : 7} fill={pts[i].items.some((p) => p.locked) ? '#FF9A6B' : '#7CE3A3'} />
        ))}
      </svg>
    </div>
  );
}

const MATERIALS = [['pet', 'PET'], ['hdpe', 'HDPE'], ['nylon', 'Nylon'], ['paper', 'Paper'], ['metal', 'Metal'], ['mixed', 'Mixed']];

function StopSheet({ stop, station, onClose, onChanged }) {
  const toast = useToast();
  const [completing, setCompleting] = useState(null);
  const f = useForm({ weightKg: '', material: 'mixed' });
  const close = () => { setCompleting(null); onClose(); };

  const start = async (p, etaMinutes) => {
    try {
      await post(`/pickups/${p.id}/start`, etaMinutes ? { etaMinutes } : {});
      toast('Residents have been told you are on the way');
      onChanged();
      close();
    } catch (e) { toast(e.message, 'error'); }
  };

  const complete = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      const body = {};
      if (v.weightKg) body.weightKg = Number(v.weightKg);
      if (completing.stream === 'recyclable') body.material = v.material;
      await post(`/pickups/${completing.id}/complete`, body);
      toast(`${STREAM[completing.stream].label} marked as emptied`);
      onChanged();
      close();
    });
  };

  const maps = stop?.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}` : null;

  return (
    <Sheet open={!!stop} onClose={close} title={stop ? stop.code : ''}>
      {stop && !completing && (
        <div className="stack">
          <p className="small muted">{stop.name}{stop.area ? ` · ${stop.area}` : ''}{station ? ` · sensor ${station.online ? 'online' : `offline (${ago(station.lastSeenAt)})`}` : ''}</p>
          {maps && <a href={maps} target="_blank" rel="noreferrer" className="btn ghost block"><Icon name="nav" size={17} />Open directions</a>}
          {stop.items.map((p) => (
            <div key={p.id} className="card stack-sm">
              <div className="row">
                <StreamSwatch stream={p.stream} />
                <div className="grow">
                  <div className="bold">{STREAM[p.stream].long}</div>
                  <div className="xs muted">{p.currentFill ?? '?'}% full{p.locked ? ' · locked' : ''} · requested {ago(p.requestedAt)}{p.eta ? ` · ETA ${timeOf(p.eta)}` : ''}</div>
                </div>
              </div>
              {p.status !== 'en_route' ? (
                <div className="stack-sm">
                  <span className="xs muted">Heading there? Tell residents when to expect you:</span>
                  <div className="choice-grid" style={{ gap: 6 }}>
                    {[15, 30, 60].map((m) => <button key={m} type="button" className="btn ghost sm" onClick={() => start(p, m)}>{m} min</button>)}
                  </div>
                </div>
              ) : null}
              <button type="button" className="btn block" onClick={() => { f.setValues({ weightKg: '', material: 'mixed' }); setCompleting(p); }}>
                <Icon name="check" size={17} stroke={2.4} />Mark as emptied
              </button>
            </div>
          ))}
        </div>
      )}
      {completing && (
        <form className="stack" onSubmit={complete}>
          <p className="small muted">{STREAM[completing.stream].long} at {stop.code}</p>
          <ErrorBox error={f.formError} />
          <Field label="Weight collected (kg)" id="w" error={f.errors.weightKg} hint={completing.stream === 'general' ? 'Optional' : 'Add it so recyclers can reserve this material'}>
            <input id="w" className="input" type="number" inputMode="decimal" min="0" step="0.1" value={f.values.weightKg} onChange={f.set('weightKg')} />
          </Field>
          {completing.stream === 'recyclable' && (
            <Field label="Main material">
              <div className="choice-grid" style={{ gap: 6 }}>
                {MATERIALS.map(([k, l]) => <button key={k} type="button" className="choice" style={{ padding: '10px 4px' }} aria-pressed={f.values.material === k} onClick={() => f.set('material')(k)}>{l}</button>)}
              </div>
            </Field>
          )}
          <div className="choice-grid two">
            <button type="button" className="btn ghost" onClick={() => setCompleting(null)}>Back</button>
            <button className="btn" disabled={f.busy}>Confirm</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

export function CollectorMap() {
  const unread = useUnread();
  const { stations } = useCollectorData();
  const [sel, setSel] = useState(null);
  const list = stations.data?.stations || [];
  const points = list.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, label: s.code, state: stationState(s) }));
  const selected = list.find((s) => s.id === sel);
  return (
    <>
      <header className="topbar">
        <h1 className="page-title md">Your stations</h1>
        <AlertsButton unread={unread} />
      </header>
      <main className="page cols" style={{ gap: 12 }}>
        <div className="col">
        <section className="map-card">
          <MapLegend />
          <StationMap points={points} height={280} highlight={sel} onSelect={(p) => setSel(p.id)} />
        </section>
        {selected && (
          <div className="card stack-sm">
            <div className="row between"><strong>{selected.code} · {selected.name}</strong><span className="xs muted">{ago(selected.lastSeenAt)}</span></div>
            {selected.compartments.map((c) => (
              <div key={c.stream} className="row small"><span style={{ width: 90 }}>{STREAM[c.stream].label}</span><div className="grow"><Bar thin value={c.fillPct} color={STREAM[c.stream].color} /></div><span className="bold" style={{ width: 40, textAlign: 'right' }}>{c.fillPct}%</span></div>
            ))}
          </div>
        )}
        </div>
        <div className="col">
        {!stations.data ? <Spinner /> : !list.length ? <Empty icon="map" title="No stations yet">Stations assigned to your company will appear here.</Empty> : list.map((s) => (
          <button key={s.id} type="button" className="card tight row" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setSel(s.id)}>
            <div className="grow">
              <div className="bold">{s.code} · {s.name}</div>
              <div className="xs muted">{s.area} · {s.online ? `live, ${ago(s.lastSeenAt)}` : `offline, ${ago(s.lastSeenAt)}`}</div>
            </div>
            <span className={`pill ${s.anyLocked ? 'locked' : s.maxFill >= 75 ? 'near' : 'ok'}`}>{s.anyLocked ? 'Locked' : `${s.maxFill}%`}</span>
          </button>
        ))}
        </div>
      </main>
    </>
  );
}
