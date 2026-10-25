import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../../lib/hooks.js';
import { patch, post } from '../../lib/api.js';
import { STREAM, STREAMS, ago, compStatus } from '../../lib/format.js';
import Icon from '../../ui/Icon.jsx';
import { Bar, Empty, ErrorBox, Field, Sheet, Spinner, StreamSwatch, copyText, useForm, useToast } from '../../ui/kit.jsx';

// Devices should talk to the API (Render) directly, not through the web app's proxy
const API_ORIGIN = (import.meta.env.VITE_DEVICE_API_URL || import.meta.env.VITE_API_URL || '').replace(/\/$/, '') || window.location.origin;

export default function Stations() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const { data, error, reload } = useApi(`/stations?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { interval: 20000 });
  const orgs = useApi('/admin/orgs?kind=collector');
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const openId = params.get('open');
  const close = () => { params.delete('open'); setParams(params, { replace: true }); };

  return (
    <>
      <header className="dash-head">
        <div><p className="muted">Smart bins and their sensors</p><h1>Stations</h1></div>
        <button type="button" className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={17} />Add station</button>
      </header>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="search" style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <Icon name="search" size={18} color="#52635A" />
          <span className="sr-only">Search stations</span>
          <input type="search" placeholder="Search code, name or area" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div role="group" className="filters">
          {[['active', 'Active'], ['maintenance', 'Maintenance'], ['retired', 'Retired'], ['all', 'All']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <section className="card">
        {!data ? <Spinner /> : !data.stations.length ? (
          <Empty icon="bin" title="No stations yet" action={<button type="button" className="btn" onClick={() => setAdding(true)}>Add your first station</button>}>
            Each station gets its own device key for the sensor.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Station</th>{STREAMS.map((s) => <th key={s}>{STREAM[s].label}</th>)}<th>Sensor</th><th>Collector</th></tr></thead>
              <tbody>
                {data.stations.map((s) => (
                  <tr key={s.id} className="click" onClick={() => setParams({ open: s.id })}>
                    <td><div className="bold">{s.code}</div><div className="xs muted">{s.name}{s.area ? ` · ${s.area}` : ''}</div></td>
                    {s.compartments.map((c) => (
                      <td key={c.stream} style={{ minWidth: 90 }}>
                        <div className="row" style={{ gap: 6 }}>
                          <div className="grow"><Bar thin value={c.fillPct} color={STREAM[c.stream].color} /></div>
                          <span className="xs bold" style={{ color: c.locked ? 'var(--orange)' : undefined }}>{c.locked ? <Icon name="lock" size={12} color="#B4430D" stroke={2.6} /> : null}{c.fillPct}%</span>
                        </div>
                      </td>
                    ))}
                    <td>
                      {!s.lastSeenAt ? <span className="pill grey">Never connected</span> : s.online ? <span className="pill ok">Online</span> : <span className="pill locked">Offline</span>}
                      <div className="xs muted" style={{ marginTop: 3 }}>{s.lastSeenAt ? ago(s.lastSeenAt) : 'waiting for first report'}{s.batteryPct != null ? ` · ${s.batteryPct}%` : ''}</div>
                    </td>
                    <td className="small">{s.collectorOrgName || <span style={{ color: '#8A3409', fontWeight: 600 }}>None</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <AddStation open={adding} onClose={() => setAdding(false)} orgs={orgs.data?.orgs || []} onCreated={(r) => { setAdding(false); reload(); setNewKey({ key: r.deviceKey, station: r.station }); }} />
      <StationSheet id={openId} onClose={close} orgs={orgs.data?.orgs || []} onChanged={reload} onKey={(k) => setNewKey(k)} />
      <KeySheet data={newKey} onClose={() => setNewKey(null)} />
    </>
  );
}

function AddStation({ open, onClose, orgs, onCreated }) {
  const f = useForm({ code: '', name: '', area: '', address: '', lat: '', lng: '', collectorOrgId: '', reportIntervalS: '300' });
  useEffect(() => { if (open) f.setValues({ code: '', name: '', area: '', address: '', lat: '', lng: '', collectorOrgId: '', reportIntervalS: '300' }); }, [open]); // eslint-disable-line
  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      const body = {
        code: v.code, name: v.name, area: v.area, address: v.address,
        lat: v.lat === '' ? null : Number(v.lat), lng: v.lng === '' ? null : Number(v.lng),
        collectorOrgId: v.collectorOrgId || null, reportIntervalS: Number(v.reportIntervalS) || 300,
      };
      onCreated(await post('/stations', body));
    });
  };
  const useHere = () => navigator.geolocation?.getCurrentPosition((p) => f.setValues((v) => ({ ...v, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })));
  return (
    <Sheet open={open} onClose={onClose} title="Add station" wide center>
      <form className="stack" onSubmit={submit} noValidate>
        <ErrorBox error={f.formError} />
        <div className="form-grid">
          <Field label="Station code" id="sc" error={f.errors.code} hint="Printed on the bin, e.g. BL-049"><input id="sc" className="input" autoCapitalize="characters" value={f.values.code} onChange={f.set('code')} /></Field>
          <Field label="Name" id="sn" error={f.errors.name}><input id="sn" className="input" placeholder="Jaja Hall bin point" value={f.values.name} onChange={f.set('name')} /></Field>
          <Field label="Area" id="sa" error={f.errors.area}><input id="sa" className="input" placeholder="UNILAG, Akoka" value={f.values.area} onChange={f.set('area')} /></Field>
          <Field label="Collection company" id="so" error={f.errors.collectorOrgId}>
            <select id="so" className="input" value={f.values.collectorOrgId} onChange={f.set('collectorOrgId')}>
              <option value="">Not assigned yet</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Latitude" id="slat" error={f.errors.lat}><input id="slat" className="input" inputMode="decimal" placeholder="6.5158" value={f.values.lat} onChange={f.set('lat')} /></Field>
          <Field label="Longitude" id="slng" error={f.errors.lng}><input id="slng" className="input" inputMode="decimal" placeholder="3.3966" value={f.values.lng} onChange={f.set('lng')} /></Field>
          <div className="full"><button type="button" className="link-btn" onClick={useHere}><Icon name="nav" size={14} style={{ display: 'inline', verticalAlign: -2 }} /> Use my current location (stand at the bin)</button></div>
          <Field label="Address" id="sad" error={f.errors.address}><input id="sad" className="input" value={f.values.address} onChange={f.set('address')} /></Field>
          <Field label="Sensor report interval (seconds)" id="si" error={f.errors.reportIntervalS} hint="300 = every 5 minutes"><input id="si" className="input" type="number" min="30" value={f.values.reportIntervalS} onChange={f.set('reportIntervalS')} /></Field>
        </div>
        <button className="btn big block" disabled={f.busy}>{f.busy ? 'Creating...' : 'Create station and device key'}</button>
      </form>
    </Sheet>
  );
}

export function KeySheet({ data, onClose }) {
  const toast = useToast();
  if (!data) return null;
  const snippet = `API_URL = "${API_ORIGIN}"\nDEVICE_KEY = "${data.key}"\nSTATION = "${data.station?.code || ''}"`;
  return (
    <Sheet open onClose={onClose} title="Device key" center>
      <div className="stack">
        <div className="notice"><Icon name="key" size={16} color="#B4430D" style={{ flexShrink: 0, marginTop: 1 }} /><span><strong>Copy this now.</strong> For security it is shown only once. If it is lost, issue a new key (the old one stops working).</span></div>
        {data.station && <p className="small muted">For {data.station.code} · {data.station.name}</p>}
        <div className="code">{data.key}</div>
        <button type="button" className="btn block" onClick={async () => toast((await copyText(data.key)) ? 'Key copied' : 'Copy failed, select it manually', 'ok')}><Icon name="copy" size={17} />Copy key</button>
        <p className="small bold">Firmware settings for the IoT engineer</p>
        <div className="code" style={{ whiteSpace: 'pre-wrap' }}>{snippet}</div>
        <button type="button" className="btn ghost block" onClick={async () => toast((await copyText(snippet)) ? 'Settings copied' : 'Copy failed')}>Copy settings</button>
        <p className="xs muted">The device sends readings to {API_ORIGIN}/api/v1/device/telemetry. Full guide: docs/IOT_INTEGRATION.md in the code repository.</p>
      </div>
    </Sheet>
  );
}

function Sparkline({ readings, stream }) {
  const pts = readings.filter((r) => r.stream === stream);
  if (pts.length < 2) return <div className="xs muted">Not enough readings yet</div>;
  const t0 = new Date(pts[0].at).getTime();
  const t1 = new Date(pts.at(-1).at).getTime();
  const d = pts.map((r, i) => `${i ? 'L' : 'M'}${(((new Date(r.at).getTime() - t0) / Math.max(1, t1 - t0)) * 300).toFixed(1)} ${(40 - (r.fillPct / 100) * 38).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 300 42" width="100%" height="42" preserveAspectRatio="none" aria-label={`${STREAM[stream].label} fill over the last 24 hours`}>
      <path d={d} fill="none" stroke={STREAM[stream].color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StationSheet({ id, onClose, orgs, onChanged, onKey }) {
  const toast = useToast();
  const { data, reload } = useApi(id ? `/stations/${id}` : null, { interval: 15000 });
  const readings = useApi(id ? `/stations/${id}/readings?hours=24` : null, { interval: 60000 });
  const [tab, setTab] = useState('live');
  const s = data?.station;
  useEffect(() => { setTab('live'); }, [id]);

  const f = useForm({});
  useEffect(() => {
    if (s) f.setValues({ name: s.name, area: s.area, address: s.address, lat: s.lat ?? '', lng: s.lng ?? '', collectorOrgId: s.collectorOrgId || '', reportIntervalS: String(s.reportIntervalS), status: s.status });
  }, [s?.id]); // eslint-disable-line

  const save = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      await patch(`/stations/${s.id}`, {
        name: v.name, area: v.area, address: v.address,
        lat: v.lat === '' ? null : Number(v.lat), lng: v.lng === '' ? null : Number(v.lng),
        collectorOrgId: v.collectorOrgId || null, reportIntervalS: Number(v.reportIntervalS), status: v.status,
      });
      toast('Station saved');
      reload(); onChanged();
    });
  };

  const toggleLock = async (c) => {
    try {
      await patch(`/stations/${s.id}/compartments/${c.stream}`, { manualLock: c.lockReason !== 'manual' });
      toast(c.lockReason === 'manual' ? 'Released. Automatic locking applies again.' : `${STREAM[c.stream].label} closed for maintenance`);
      reload(); onChanged();
    } catch (e) { toast(e.message, 'error'); }
  };
  const requestPickup = async (c) => {
    try {
      const r = await post('/pickups', { stationId: s.id, stream: c.stream });
      toast(r.created ? 'Pickup requested' : 'A pickup is already open for this compartment');
      reload(); onChanged();
    } catch (e) { toast(e.message, 'error'); }
  };
  const rotate = async () => {
    if (!window.confirm(`Issue a new device key for ${s.code}? The current sensor will stop being accepted until it is updated with the new key.`)) return;
    try {
      const r = await post(`/stations/${s.id}/device-key`);
      onKey({ key: r.deviceKey, station: s });
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <Sheet open={!!id} onClose={onClose} title={s ? s.code : 'Station'} wide center>
      {!s ? <Spinner /> : (
        <div className="stack">
          <p className="small muted">{s.name}{s.area ? ` · ${s.area}` : ''}</p>
          <div className="row wrap" style={{ gap: 8 }}>
            {!s.lastSeenAt ? <span className="chip">Never connected</span> : s.online ? <span className="chip ok"><span className="dot" />Online</span> : <span className="chip off"><span className="dot" />Offline</span>}
            <span className="chip">Last report {ago(s.lastSeenAt)}</span>
            {s.batteryPct != null && <span className="chip"><Icon name="sun" size={14} color="#7A5B00" />{s.batteryPct}%{s.solarV != null ? ` · ${s.solarV} V` : ''}</span>}
            {s.rssi != null && <span className="chip">Signal {s.rssi} dBm</span>}
            {s.firmware && <span className="chip">FW {s.firmware}</span>}
          </div>
          <div role="group" className="filters">
            {[['live', 'Live'], ['calibrate', 'Calibrate'], ['device', 'Device'], ['edit', 'Details']].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === 'live' && s.compartments.map((c) => {
            const st = compStatus(c);
            const open = s.openPickups.find((p) => p.stream === c.stream);
            return (
              <div key={c.stream} className="card stack-sm">
                <div className="row">
                  <StreamSwatch stream={c.stream} />
                  <div className="grow"><div className="bold">{STREAM[c.stream].long}</div><div className="xs muted">{st.text}{c.updatedAt ? ` · ${ago(c.updatedAt)}` : ''}{open ? ` · pickup ${open.status.replace('_', ' ')}` : ''}</div></div>
                  <div className="num" style={{ fontSize: 22 }}>{c.fillPct}%</div>
                </div>
                <Bar value={c.fillPct} color={STREAM[c.stream].color} />
                <Sparkline readings={readings.data?.readings || []} stream={c.stream} />
                <div className="row wrap" style={{ gap: 8 }}>
                  <button type="button" className="btn ghost sm" onClick={() => toggleLock(c)}><Icon name={c.lockReason === 'manual' ? 'unlock' : 'lock'} size={15} />{c.lockReason === 'manual' ? 'Release maintenance lock' : 'Close for maintenance'}</button>
                  {!open && <button type="button" className="btn ghost sm" onClick={() => requestPickup(c)}><Icon name="truck" size={15} />Request pickup</button>}
                </div>
              </div>
            );
          })}

          {tab === 'calibrate' && <Calibrate station={s} onSaved={() => { reload(); onChanged(); }} />}

          {tab === 'device' && (
            <div className="stack">
              <div className="card stack-sm">
                <div className="kv"><span>Active key</span><span className="bold">{s.deviceKeyPrefix ? `blk_${s.deviceKeyPrefix}_••••••` : 'None'}</span></div>
                <div className="kv"><span>Key last used</span><span>{ago(s.deviceLastUsedAt)}</span></div>
                <div className="kv"><span>Reports every</span><span>{s.reportIntervalS}s</span></div>
                <div className="kv"><span>Marked offline after</span><span>{Math.round((s.reportIntervalS * 3) / 60)} min without data</span></div>
              </div>
              <div className="notice info"><Icon name="info" size={16} style={{ flexShrink: 0, marginTop: 1 }} /><span>Keys are stored hashed, so the full key cannot be shown again. Issue a new one if the sensor is being set up or the key may have leaked.</span></div>
              <button type="button" className="btn dark block" onClick={rotate}><Icon name="key" size={17} />Issue new device key</button>
            </div>
          )}

          {tab === 'edit' && (
            <form className="stack" onSubmit={save} noValidate>
              <ErrorBox error={f.formError} />
              <div className="form-grid">
                <Field label="Name" id="en" error={f.errors.name}><input id="en" className="input" value={f.values.name || ''} onChange={f.set('name')} /></Field>
                <Field label="Area" id="ea" error={f.errors.area}><input id="ea" className="input" value={f.values.area || ''} onChange={f.set('area')} /></Field>
                <Field label="Collection company" id="eo">
                  <select id="eo" className="input" value={f.values.collectorOrgId || ''} onChange={f.set('collectorOrgId')}>
                    <option value="">Not assigned</option>
                    {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>
                <Field label="Status" id="es">
                  <select id="es" className="input" value={f.values.status || 'active'} onChange={f.set('status')}>
                    <option value="active">Active</option><option value="maintenance">Maintenance</option><option value="retired">Retired (stops accepting data)</option>
                  </select>
                </Field>
                <Field label="Latitude" id="elat" error={f.errors.lat}><input id="elat" className="input" inputMode="decimal" value={f.values.lat ?? ''} onChange={f.set('lat')} /></Field>
                <Field label="Longitude" id="elng" error={f.errors.lng}><input id="elng" className="input" inputMode="decimal" value={f.values.lng ?? ''} onChange={f.set('lng')} /></Field>
                <Field label="Address" id="ead"><input id="ead" className="input" value={f.values.address || ''} onChange={f.set('address')} /></Field>
                <Field label="Report interval (seconds)" id="ei" error={f.errors.reportIntervalS}><input id="ei" className="input" type="number" min="30" value={f.values.reportIntervalS || ''} onChange={f.set('reportIntervalS')} /></Field>
              </div>
              <button className="btn block" disabled={f.busy}>Save changes</button>
            </form>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Calibrate({ station, onSaved }) {
  const toast = useToast();
  const initial = useMemo(() => Object.fromEntries(station.compartments.map((c) => [c.stream, {
    emptyDistanceCm: c.emptyDistanceCm, fullDistanceCm: c.fullDistanceCm,
    nearFullThreshold: c.nearFullThreshold, lockThreshold: c.lockThreshold, unlockThreshold: c.unlockThreshold,
  }])), [station]);
  const [vals, setVals] = useState(initial);
  const [errs, setErrs] = useState({});
  const set = (st, k) => (e) => setVals((v) => ({ ...v, [st]: { ...v[st], [k]: e.target.value } }));
  const save = async (st) => {
    setErrs((x) => ({ ...x, [st]: null }));
    try {
      const v = vals[st];
      await patch(`/stations/${station.id}/compartments/${st}`, Object.fromEntries(Object.entries(v).map(([k, n]) => [k, Number(n)])));
      toast(`${STREAM[st].label} calibration saved`);
      onSaved();
    } catch (e) { setErrs((x) => ({ ...x, [st]: Object.values(e.fields || {})[0] || e.message })); }
  };
  return (
    <div className="stack">
      <div className="notice info"><Icon name="info" size={16} style={{ flexShrink: 0, marginTop: 1 }} /><span>Only needed if the sensor sends raw distance. Measure from the sensor to the bottom of the empty bin, and to where waste should stop when full.</span></div>
      {STREAMS.map((st) => (
        <div key={st} className="card stack-sm">
          <div className="row"><StreamSwatch stream={st} size={28} /><strong>{STREAM[st].long}</strong></div>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
            <Field label="Empty (cm)"><input className="input" type="number" value={vals[st].emptyDistanceCm} onChange={set(st, 'emptyDistanceCm')} /></Field>
            <Field label="Full (cm)"><input className="input" type="number" value={vals[st].fullDistanceCm} onChange={set(st, 'fullDistanceCm')} /></Field>
            <Field label="Near full %"><input className="input" type="number" value={vals[st].nearFullThreshold} onChange={set(st, 'nearFullThreshold')} /></Field>
            <Field label="Lock at %"><input className="input" type="number" value={vals[st].lockThreshold} onChange={set(st, 'lockThreshold')} /></Field>
            <Field label="Unlock below %"><input className="input" type="number" value={vals[st].unlockThreshold} onChange={set(st, 'unlockThreshold')} /></Field>
          </div>
          {errs[st] && <span className="xs bold" style={{ color: 'var(--orange)' }}>{errs[st]}</span>}
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => save(st)}>Save {STREAM[st].label.toLowerCase()}</button>
        </div>
      ))}
    </div>
  );
}
