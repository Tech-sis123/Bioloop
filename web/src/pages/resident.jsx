import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/hooks.js';
import { patch, post } from '../lib/api.js';
import { STREAM, STREAMS, ago, compStatus, firstName, greeting, headline, initials, timeOf, whenLabel } from '../lib/format.js';
import Icon from '../ui/Icon.jsx';
import { AlertsButton, BackHeader, Bar, Empty, ErrorBox, Field, Logo, Sheet, Spinner, StreamSwatch, useForm, useToast, useUnread } from '../ui/kit.jsx';

const REWARD_STEP = 500;

/* ---------- Home ---------- */
export function ResidentHome() {
  const { user } = useAuth();
  const unread = useUnread();
  const stationPath = user.homeStationId ? `/stations/${user.homeStationId}` : null;
  const { data, error, reload } = useApi(stationPath, { interval: 20000 });
  const activity = useApi('/me/activity', { interval: 60000 });
  const [report, setReport] = useState(false);
  const [drop, setDrop] = useState(false);
  const station = data?.station;
  const [l1, l2] = headline(station);

  return (
    <>
      <header className="topbar">
        <Logo />
        <AlertsButton unread={unread} />
      </header>
      <main className="page">
        <div>
          <p className="small muted" style={{ fontSize: 14 }}>{greeting()}, {firstName(user.fullName)}</p>
          <h1 className="display" style={{ fontSize: 28, marginTop: 4 }}>{l1}<br />{l2}</h1>
        </div>

        <ErrorBox error={error} onRetry={reload} />
        {!user.homeStationId ? (
          <Link to="/find" className="hero">
            <div className="row between">
              <div className="stack-sm" style={{ gap: 2 }}>
                <span className="eyebrow">Your station</span>
                <span style={{ fontSize: 16, fontWeight: 600 }}>Choose the bin you use most</span>
              </div>
              <span className="hero-chev"><Icon name="chevron" size={18} color="#fff" /></span>
            </div>
            <div className="hero-strip"><Icon name="pin" color="#fff" /><span>Find a BioLoop station near you</span></div>
          </Link>
        ) : !station ? (
          <div className="skeleton" style={{ height: 270, borderRadius: 26 }} />
        ) : (
          <HeroCard station={station} />
        )}

        <div className="quick">
          <Link to="/find"><span className="quick-ico" style={{ background: '#DDEEE2' }}><Icon name="pin" size={19} color="#1F6B45" /></span>Find a bin</Link>
          <button type="button" onClick={() => setReport(true)}><span className="quick-ico" style={{ background: '#FCE7D6' }}><Icon name="flag" size={19} color="#B4430D" /></span>Report</button>
          <Link to="/sort-guide"><span className="quick-ico" style={{ background: '#DCE8F5' }}><Icon name="recycle" size={19} color="#255F9A" /></span>Sort guide</Link>
          <Link to="/rewards"><span className="quick-ico" style={{ background: '#F8EFC9' }}><Icon name="medal" size={19} color="#7A5B00" /></span>Rewards</Link>
        </div>

        <section className="card tight stack" style={{ gap: 10 }}>
          <div className="row between">
            <h2>Recent activity</h2>
            <span className="pill points">{(activity.data?.points ?? user.points).toLocaleString()} Loop points</span>
          </div>
          {activity.data?.activity?.length ? activity.data.activity.slice(0, 3).map((a) => (
            <div className="act" key={a.id}>
              <i style={{ background: STREAM[a.stream]?.color || '#2E8B57' }} />
              <div className="grow">
                <div style={{ fontSize: 14, fontWeight: 600 }}>{a.reason === 'drop' ? `Dropped ${a.weightKg ? `${a.weightKg} kg of ` : ''}${STREAM[a.stream]?.label.toLowerCase() || 'waste'}` : a.reason}</div>
                <div className="xs muted">{whenLabel(a.at)}{a.stationCode ? ` · ${a.stationCode}` : ''}</div>
              </div>
              <span className="bold small" style={{ color: 'var(--green)' }}>+{a.amount}</span>
            </div>
          )) : <p className="small muted">Log your sorted drop-offs to start earning Loop points.</p>}
          {station && <button type="button" className="btn ghost block" onClick={() => setDrop(true)}><Icon name="plus" size={17} />Log a drop</button>}
        </section>
      </main>
      <ReportSheet open={report} onClose={() => setReport(false)} station={station} />
      <DropSheet open={drop} onClose={() => setDrop(false)} station={station} onDone={() => activity.reload()} />
    </>
  );
}

function HeroCard({ station }) {
  const enRoute = station.openPickups.find((p) => p.status === 'en_route');
  const anyPickup = enRoute || station.openPickups[0];
  return (
    <Link to={`/stations/${station.id}`} className="hero">
      <div className="row between">
        <div className="stack-sm" style={{ gap: 2 }}>
          <span className="eyebrow">Your station</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{station.code} · {station.area || station.name}</span>
        </div>
        <span className="hero-chev"><Icon name="chevron" size={18} color="#fff" /></span>
      </div>
      <div className="tanks">
        {station.compartments.map((c) => (
          <div key={c.stream}>
            <div className={`tank ${c.locked ? 'locked' : ''}`}>
              <div className="tank-fill" style={{ height: `${c.fillPct}%`, background: STREAM[c.stream].hero }} />
              {c.locked && <div className="tank-lock"><Icon name="lock" size={15} color="#F6A55E" stroke={2.4} /></div>}
            </div>
            <div className="tank-num">{c.fillPct}%</div>
            <div className={`tank-label ${c.locked ? 'alert' : ''}`}>{STREAM[c.stream].label}{c.locked ? ' · locked' : ''}</div>
          </div>
        ))}
      </div>
      <div className="hero-strip">
        <Icon name={anyPickup ? 'truck' : station.online ? 'wifi' : 'wifiOff'} color="#fff" />
        {enRoute ? (
          <span>{enRoute.orgName || 'Collector'} arriving{enRoute.eta ? <> <strong>{timeOf(enRoute.eta)}</strong></> : ' soon'}</span>
        ) : anyPickup ? (
          <span>Pickup assigned to <strong>{anyPickup.orgName || 'a collector'}</strong></span>
        ) : (
          <span>{station.online ? `Live · updated ${ago(station.lastSeenAt)}` : `Sensor offline · last seen ${ago(station.lastSeenAt)}`}</span>
        )}
      </div>
    </Link>
  );
}

/* ---------- Station detail ---------- */
export function StationDetail() {
  const { id } = useParams();
  const { user, setUser } = useAuth();
  const toast = useToast();
  const stationId = id || user.homeStationId;
  const { data, error, reload } = useApi(stationId ? `/stations/${stationId}` : null, { interval: 20000 });
  const [report, setReport] = useState(false);
  const [drop, setDrop] = useState(false);
  const s = data?.station;
  const isResident = user.role === 'resident';
  const isHome = s && user.homeStationId === s.id;

  if (!stationId) {
    return (
      <>
        <BackHeader title="My bin" to="/" />
        <main className="page"><Empty icon="bin" title="No bin chosen yet" action={<Link className="btn" to="/find">Find a bin</Link>}>Pick the station you use and we will keep you posted.</Empty></main>
      </>
    );
  }

  const makeHome = async () => {
    try {
      const r = await patch('/me', { homeStationCode: s.code });
      setUser(r.user);
      toast(`${s.code} is now your bin`);
    } catch (e) { toast(e.message, 'error'); }
  };

  const pickup = s?.openPickups.find((p) => p.status === 'en_route') || s?.openPickups[0];
  const maps = s?.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}` : null;

  return (
    <>
      <BackHeader title={s?.code || 'Station'} subtitle={s ? `${s.name}${s.area ? ` · ${s.area}` : ''}` : ''} />
      <main className="page" style={{ gap: 14 }}>
        <ErrorBox error={error} onRetry={reload} />
        {!s ? <Spinner /> : (
          <>
            <div className="row wrap" style={{ gap: 8 }}>
              {s.online
                ? <span className="chip ok"><span className="dot" />Online</span>
                : <span className="chip off"><span className="dot" />Offline</span>}
              {s.batteryPct != null && <span className="chip"><Icon name="sun" size={14} color="#7A5B00" />Solar battery {s.batteryPct}%</span>}
              <span className="chip muted">Updated {ago(s.lastSeenAt)}</span>
            </div>

            <section aria-label="Compartments" className="card stack" style={{ gap: 16 }}>
              {s.compartments.map((c) => {
                const st = compStatus(c);
                return (
                  <div key={c.stream} className="stack-sm">
                    <div className="row">
                      <StreamSwatch stream={c.stream} />
                      <div className="grow">
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{STREAM[c.stream].long}</div>
                        <div className="xs muted">{STREAM[c.stream].hint}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="num" style={{ fontSize: 20 }}>{c.fillPct}%</div>
                        <div className="xs" style={{ color: st.tone === 'locked' ? 'var(--orange)' : st.tone === 'near' || st.tone === 'filling' ? '#8A5A00' : 'var(--muted)', fontWeight: st.tone === 'open' ? 400 : 700 }}>{st.text}</div>
                      </div>
                    </div>
                    <Bar value={c.fillPct} color={STREAM[c.stream].color} />
                    {c.locked && (
                      <div className="notice">
                        <Icon name="lock" size={16} color="#B4430D" stroke={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span>{c.lockReason === 'manual' ? 'Closed by the BioLoop team for maintenance.' : 'Lid locked to stop overflow. It opens again once the collector empties it.'}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>

            <section aria-label="Collection" className="card stack">
              <div className="row between">
                <h2>Pickup</h2>
                {pickup ? <span className="pill ok">{pickup.status === 'en_route' ? 'On the way' : pickup.status === 'assigned' ? 'Assigned' : 'Requested'}</span> : <span className="pill grey">Not needed</span>}
              </div>
              {pickup ? (
                <div className="row">
                  <span className="avatar">{initials(pickup.orgName || s.collectorOrgName || 'BL')}</span>
                  <div className="grow">
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{pickup.orgName || s.collectorOrgName || 'Finding a collector'}</div>
                    <div className="small muted">
                      {pickup.status === 'en_route' && pickup.eta ? `Arriving ${timeOf(pickup.eta)}` : pickup.status === 'en_route' ? 'On the way' : `Requested ${ago(pickup.requestedAt)}`}
                      {' · '}{STREAM[pickup.stream].label}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="small muted">All compartments have room. A pickup is requested automatically when one gets near full.</p>
              )}
              <div className="choice-grid two">
                {s.collectorPhone
                  ? <a href={`tel:${s.collectorPhone}`} className="btn ghost"><Icon name="phone" size={17} />Call</a>
                  : <span className="btn ghost" aria-disabled="true" style={{ opacity: 0.5 }}><Icon name="phone" size={17} />Call</span>}
                {maps
                  ? <a href={maps} target="_blank" rel="noreferrer" className="btn"><Icon name="pin" size={17} />Directions</a>
                  : <span className="btn" style={{ opacity: 0.5 }}><Icon name="pin" size={17} />Directions</span>}
              </div>
            </section>

            {isResident && (
              <>
                {!isHome && <button type="button" className="btn dark block" onClick={makeHome}><Icon name="home" size={17} />Make this my bin</button>}
                <button type="button" className="btn ghost block" onClick={() => setDrop(true)}><Icon name="plus" size={17} />Log a drop</button>
              </>
            )}
            <button type="button" className="btn dashed block" onClick={() => setReport(true)}><Icon name="flag" size={17} color="#B4430D" />Report a problem with this bin</button>
          </>
        )}
      </main>
      <ReportSheet open={report} onClose={() => setReport(false)} station={s} />
      <DropSheet open={drop} onClose={() => setDrop(false)} station={s} onDone={reload} />
    </>
  );
}

/* ---------- Sheets ---------- */
const REPORT_CATS = [
  ['overflow', 'Overflowing'], ['damaged', 'Damaged'], ['odour', 'Bad smell'],
  ['sensor', 'Wrong reading'], ['blocked', 'Blocked access'], ['other', 'Other'],
];

export function ReportSheet({ open, onClose, station }) {
  const toast = useToast();
  const f = useForm({ category: '', description: '' });
  useEffect(() => { if (open) f.setValues({ category: '', description: '' }); }, [open]); // eslint-disable-line
  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      await post('/reports', { stationId: station.id, category: v.category, description: v.description });
      toast('Thanks. The BioLoop team has been notified.');
      onClose();
    });
  };
  return (
    <Sheet open={open} onClose={onClose} title="Report a problem">
      {!station ? <Empty icon="bin" title="Choose a bin first" action={<Link to="/find" className="btn" onClick={onClose}>Find a bin</Link>} /> : (
        <form className="stack" onSubmit={submit}>
          <p className="small muted">About {station.code} · {station.name}</p>
          <ErrorBox error={f.formError} />
          <div className="choice-grid">
            {REPORT_CATS.map(([k, l]) => (
              <button type="button" key={k} className="choice" aria-pressed={f.values.category === k} onClick={() => f.set('category')(k)}>{l}</button>
            ))}
          </div>
          {f.errors.category && <span className="err xs" style={{ color: 'var(--orange)' }}>Pick what is wrong</span>}
          <Field label="Details (optional)" id="desc" error={f.errors.description}>
            <textarea id="desc" className="input" maxLength={500} placeholder="What did you notice?" value={f.values.description} onChange={f.set('description')} />
          </Field>
          <button className="btn block big" disabled={f.busy || !f.values.category}>Send report</button>
        </form>
      )}
    </Sheet>
  );
}

export function DropSheet({ open, onClose, station, onDone }) {
  const toast = useToast();
  const { reload } = useAuth();
  const [stream, setStream] = useState(null);
  const f = useForm({});
  useEffect(() => { if (open) setStream(null); }, [open]);
  const submit = () => f.run(async () => {
    const r = await post('/me/drops', { stationId: station.id, stream });
    toast(`+${r.amount} Loop points. Thanks for sorting!`);
    reload().catch(() => {});
    onDone?.();
    onClose();
  });
  return (
    <Sheet open={open} onClose={onClose} title="Log a drop">
      {station && (
        <div className="stack">
          <p className="small muted">Which compartment did you use at {station.code}?</p>
          <ErrorBox error={f.formError} />
          <div className="choice-grid">
            {station.compartments.map((c) => (
              <button type="button" key={c.stream} className="choice" disabled={c.locked} aria-pressed={stream === c.stream} onClick={() => setStream(c.stream)}>
                <StreamSwatch stream={c.stream} size={30} />
                {STREAM[c.stream].label}
                <span className="xs muted" style={{ fontWeight: 500 }}>{c.locked ? 'Locked' : `+${{ recyclable: 10, organic: 6, general: 2 }[c.stream]} pts`}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn block big" disabled={!stream || f.busy} onClick={submit}>Log drop</button>
          <p className="xs muted center">Up to 4 drops a day count toward points.</p>
        </div>
      )}
    </Sheet>
  );
}

/* ---------- Find a bin ---------- */
function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function FindBin() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [here, setHere] = useState(null);
  const [locErr, setLocErr] = useState(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data, error, reload } = useApi(`/stations${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`, { interval: 60000 });

  const list = useMemo(() => {
    const rows = (data?.stations || []).map((s) => ({ ...s, km: here && s.lat != null ? distanceKm(here, s) : null }));
    return here ? rows.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9)) : rows;
  }, [data, here]);

  const locate = () => {
    setLocErr(null);
    if (!navigator.geolocation) return setLocErr('Location is not available on this device.');
    navigator.geolocation.getCurrentPosition(
      (p) => setHere({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setLocErr('Could not get your location. You can still search by name.'),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  };

  return (
    <>
      <BackHeader title="Find a bin" subtitle="Stations with room right now" to="/" />
      <main className="page" style={{ gap: 12 }}>
        <label className="search">
          <Icon name="search" size={18} color="#52635A" />
          <span className="sr-only">Search stations</span>
          <input type="search" placeholder="Search code, place or area" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="button" className="btn ghost block" onClick={locate}><Icon name="nav" size={17} />{here ? 'Sorted by distance' : 'Use my location'}</button>
        {locErr && <p className="xs muted">{locErr}</p>}
        <ErrorBox error={error} onRetry={reload} />
        {!data ? <Spinner /> : !list.length ? <Empty icon="search" title="No stations found">Try a different name or area.</Empty> : list.map((s) => (
          <Link key={s.id} to={`/stations/${s.id}`} className="card tight stack" style={{ textDecoration: 'none', color: 'inherit', gap: 10 }}>
            <div className="row">
              <div className="grow">
                <div style={{ fontSize: 15, fontWeight: 700 }}>{s.code} · {s.name}</div>
                <div className="small muted">{s.area || s.zone}{s.km != null ? ` · ${s.km < 1 ? `${Math.round(s.km * 1000)} m` : `${s.km.toFixed(1)} km`}` : ''}</div>
              </div>
              {!s.online ? <span className="pill grey">Offline</span> : s.anyLocked ? <span className="pill locked">Part locked</span> : <span className="pill ok">Open</span>}
            </div>
            <div className="choice-grid" style={{ gap: 6 }}>
              {s.compartments.map((c) => (
                <div key={c.stream}>
                  <Bar thin value={c.fillPct} color={STREAM[c.stream].color} />
                  <div className="xs" style={{ marginTop: 4, color: c.locked ? 'var(--orange)' : 'var(--muted)', fontWeight: c.locked ? 700 : 400 }}>
                    {STREAM[c.stream].label} {c.locked ? 'locked' : `${c.fillPct}%`}
                  </div>
                </div>
              ))}
            </div>
          </Link>
        ))}
      </main>
    </>
  );
}

/* ---------- Sort guide ---------- */
const GUIDE = [
  { stream: 'recyclable', yes: ['PET bottles (water, soft drinks)', 'Drink cans', 'Clean paper and cartons', 'Plastic containers (rinsed)'], no: ['Pure water sachets with food', 'Greasy food packs', 'Broken glass'] },
  { stream: 'organic', yes: ['Food scraps and leftovers', 'Fruit and vegetable peels', 'Leaves and garden waste', 'Eggshells'], no: ['Nylon bags', 'Bones in large amounts', 'Oil and liquids'] },
  { stream: 'general', yes: ['Nylon and food wrappers', 'Pure water sachets', 'Tissue and napkins', 'Mixed or dirty packaging'], no: ['Batteries and e-waste', 'Medical waste', 'Hot ashes'] },
];

export function SortGuide() {
  return (
    <>
      <BackHeader title="Sort guide" subtitle="What goes where" to="/" />
      <main className="page" style={{ gap: 12 }}>
        <div className="notice info"><Icon name="info" size={16} style={{ flexShrink: 0, marginTop: 1 }} /><span>Clean, sorted recyclables go straight to local recyclers. One dirty item can spoil a whole batch.</span></div>
        {GUIDE.map((g) => (
          <section key={g.stream} className="card stack">
            <div className="row"><StreamSwatch stream={g.stream} /><h2 style={{ fontSize: 17 }}>{STREAM[g.stream].long}</h2></div>
            <div className="stack-sm">
              {g.yes.map((t) => <div key={t} className="row small"><Icon name="check" size={16} color="#1F6B45" stroke={2.4} />{t}</div>)}
            </div>
            <div className="divider" />
            <div className="stack-sm">
              <span className="eyebrow">Keep out</span>
              {g.no.map((t) => <div key={t} className="row small muted"><Icon name="x" size={16} color="#B4430D" stroke={2.4} />{t}</div>)}
            </div>
          </section>
        ))}
        <p className="xs muted center">Batteries, phones and medical waste need special drop points. Ask your local waste office.</p>
      </main>
    </>
  );
}

/* ---------- Rewards ---------- */
export function Rewards() {
  const { data, error, reload } = useApi('/me/activity');
  const points = data?.points ?? 0;
  const next = Math.ceil((points + 1) / REWARD_STEP) * REWARD_STEP;
  const progress = ((points % REWARD_STEP) / REWARD_STEP) * 100;
  return (
    <>
      <BackHeader title="Rewards" subtitle="Loop points for sorting right" to="/" />
      <main className="page" style={{ gap: 12 }}>
        <ErrorBox error={error} onRetry={reload} />
        <section className="hero" style={{ background: '#7A5B00' }}>
          <span className="eyebrow">Your Loop points</span>
          <div className="num" style={{ fontSize: 44 }}>{points.toLocaleString()}</div>
          <div className="stack-sm">
            <div className="bar" style={{ background: 'rgba(255,255,255,0.18)' }}><div style={{ width: `${progress}%`, background: '#F8EFC9' }} /></div>
            <span className="small" style={{ color: 'rgba(255,255,255,0.85)' }}>{next - points} more to your next reward at {next.toLocaleString()}</span>
          </div>
        </section>
        <section className="card stack-sm">
          <h2>How to earn</h2>
          {STREAMS.map((s) => (
            <div key={s} className="row small"><StreamSwatch stream={s} size={28} /><span className="grow">{STREAM[s].long} drop</span><strong>+{{ recyclable: 10, organic: 6, general: 2 }[s]}</strong></div>
          ))}
          <p className="xs muted" style={{ marginTop: 4 }}>Up to 4 drops a day. Rewards like airtime are paid out by the BioLoop team when you reach each milestone.</p>
        </section>
        <section className="card tight stack" style={{ gap: 10 }}>
          <h2>History</h2>
          {!data ? <Spinner /> : !data.activity.length ? <p className="small muted">No points yet. Log your first drop from your bin page.</p> : data.activity.map((a) => (
            <div className="act" key={a.id}>
              <i style={{ background: STREAM[a.stream]?.color || '#2E8B57' }} />
              <div className="grow">
                <div style={{ fontSize: 14, fontWeight: 600 }}>{a.reason === 'drop' ? `${STREAM[a.stream]?.label || 'Waste'} drop` : a.reason}</div>
                <div className="xs muted">{whenLabel(a.at)}{a.stationCode ? ` · ${a.stationCode}` : ''}</div>
              </div>
              <span className="bold small" style={{ color: 'var(--green)' }}>+{a.amount}</span>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}

export function useGoHome() {
  const nav = useNavigate();
  return () => nav('/');
}
