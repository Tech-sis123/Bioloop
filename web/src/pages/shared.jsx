import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/hooks.js';
import { patch, post } from '../lib/api.js';
import { dayLabel, initials, isToday, timeOf } from '../lib/format.js';
import Icon from '../ui/Icon.jsx';
import { BackHeader, Empty, ErrorBox, Field, Spinner, useForm, useToast } from '../ui/kit.jsx';

const KIND_STYLE = {
  locked: { icon: 'lock', bg: '#FCE7D6', color: '#B4430D', warn: true },
  manual_lock: { icon: 'lock', bg: '#FCE7D6', color: '#B4430D' },
  near_full: { icon: 'bin', bg: '#F8E3B0', color: '#6B4700' },
  offline: { icon: 'wifiOff', bg: '#FCE7D6', color: '#B4430D', warn: true },
  station_online: { icon: 'wifi', bg: '#DDEEE2', color: '#1F6B45' },
  battery_low: { icon: 'sun', bg: '#F8EFC9', color: '#7A5B00', warn: true },
  device_event: { icon: 'info', bg: '#FCE7D6', color: '#B4430D', warn: true },
  problem_report: { icon: 'flag', bg: '#FCE7D6', color: '#B4430D' },
  pickup_assigned: { icon: 'truck', bg: '#DDEEE2', color: '#1F6B45' },
  pickup_unassigned: { icon: 'truck', bg: '#FCE7D6', color: '#B4430D', warn: true },
  en_route: { icon: 'truck', bg: '#DDEEE2', color: '#1F6B45' },
  pickup_completed: { icon: 'check', bg: '#DDEEE2', color: '#1F6B45' },
  emptied: { icon: 'unlock', bg: '#DDEEE2', color: '#1F6B45' },
  unlocked: { icon: 'unlock', bg: '#DDEEE2', color: '#1F6B45' },
  points: { icon: 'medal', bg: '#F8EFC9', color: '#7A5B00' },
  batch_reserved: { icon: 'box', bg: '#DCE8F5', color: '#255F9A' },
  report_resolved: { icon: 'check', bg: '#DDEEE2', color: '#1F6B45' },
};

const FILTERS = [['all', 'All'], ['bin', 'Bins'], ['pickup', 'Pickups'], ['reward', 'Rewards']];

export function AlertsList({ embedded = false }) {
  const [filter, setFilter] = useState('all');
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, error, reload, setData } = useApi(`/notifications${filter === 'all' ? '' : `?category=${filter}`}`, { interval: 20000 });

  const groups = useMemo(() => {
    const today = [];
    const earlier = [];
    for (const n of data?.notifications || []) (isToday(n.at) ? today : earlier).push(n);
    return [['Today', today], ['Earlier', earlier]].filter(([, l]) => l.length);
  }, [data]);

  const markAll = async () => {
    await post('/notifications/read-all');
    setData((d) => d && { ...d, unread: 0, notifications: d.notifications.map((n) => ({ ...n, read: true })) });
  };
  const open = async (n) => {
    if (!n.read) {
      post(`/notifications/${n.id}/read`).catch(() => {});
      setData((d) => d && { ...d, notifications: d.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)) });
    }
    if (!n.stationId) return;
    if (user.role === 'agency' || user.role === 'admin') nav(`/dashboard/stations?open=${n.stationId}`);
    else if (user.role !== 'recycler') nav(`/stations/${n.stationId}`);
  };

  const filters = user.role === 'resident' ? FILTERS : FILTERS.filter(([k]) => k !== 'reward');

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row between" style={embedded ? {} : { display: 'none' }}>
        <span />
        <button type="button" className="link-btn" onClick={markAll}>Mark all read</button>
      </div>
      <div role="group" aria-label="Filter alerts" className="filters">
        {filters.map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {!data ? <Spinner /> : !groups.length ? <Empty icon="bell" title="No alerts yet">We will let you know when a bin fills up or a pickup is on the way.</Empty> : groups.map(([label, list]) => (
        <div key={label} className="stack" style={{ gap: 10 }}>
          <h2 className="eyebrow" style={{ marginTop: 4 }}>{label}</h2>
          {list.map((n) => {
            const k = KIND_STYLE[n.kind] || { icon: 'bell', bg: '#EEF1EA', color: '#52635A' };
            return (
              <button type="button" key={n.id} className={`alert-item ${!n.read && k.warn ? 'unread-warn' : ''}`} onClick={() => open(n)}>
                <span className="alert-ico" style={{ background: k.bg }}><Icon name={k.icon} size={19} color={k.color} stroke={2.2} /></span>
                <span className="grow stack-sm" style={{ gap: 3 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{n.title}</span>
                  {n.body && <span className="small muted" style={{ lineHeight: 1.4 }}>{n.body}</span>}
                  <span className="xs muted" style={{ marginTop: 2 }}>{isToday(n.at) ? timeOf(n.at) : dayLabel(n.at)}</span>
                </span>
                {!n.read && <span aria-label="Unread" className="unread-dot" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function AlertsPage() {
  const [key, setKey] = useState(0);
  return (
    <>
      <header className="topbar" style={{ alignItems: 'flex-end', paddingTop: 22 }}>
        <h1 className="page-title">Alerts</h1>
        <button type="button" className="link-btn" onClick={async () => { await post('/notifications/read-all'); setKey((k) => k + 1); }}>Mark all read</button>
      </header>
      <main className="page" style={{ paddingTop: 4 }}>
        <AlertsList key={key} />
      </main>
    </>
  );
}

const ROLE_LABEL = { resident: 'Resident', collector: 'Collector', recycler: 'Recycler', agency: 'Agency staff', admin: 'Admin' };

export function ProfilePage() {
  const { user, setUser, logout, accept } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const f = useForm({ fullName: user.fullName, phone: user.phone || '' });
  const pw = useForm({ currentPassword: '', newPassword: '' });
  const home = useApi(user.homeStationId ? `/stations/${user.homeStationId}` : null);

  const save = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      const r = await patch('/me', v);
      setUser(r.user);
      toast('Profile saved');
    });
  };
  const changePw = (e) => {
    e.preventDefault();
    pw.run(async (v) => {
      const r = await post('/auth/change-password', v);
      accept(r);
      pw.setValues({ currentPassword: '', newPassword: '' });
      toast('Password changed. Other devices were signed out.');
    });
  };
  const signOut = async () => { await logout(); nav('/login'); };
  const signOutAll = async () => {
    await post('/auth/logout-all').catch(() => {});
    await logout();
    nav('/login');
  };

  return (
    <>
      <BackHeader title="Profile" to="/" />
      <main className="page" style={{ gap: 14 }}>
        <section className="card row">
          <span className="avatar">{initials(user.fullName)}</span>
          <div className="grow">
            <div className="bold">{user.fullName}</div>
            <div className="small muted truncate">{user.email}</div>
          </div>
          <span className="pill ok">{ROLE_LABEL[user.role]}</span>
        </section>
        {user.orgName && <div className="notice info"><Icon name="users" size={16} style={{ flexShrink: 0, marginTop: 1 }} /><span>You are part of <strong>{user.orgName}</strong>.</span></div>}
        {user.role === 'resident' && (
          <section className="card row">
            <Icon name="bin" color="#1F6B45" />
            <div className="grow">
              <div className="bold small">My bin</div>
              <div className="small muted">{home.data?.station ? `${home.data.station.code} · ${home.data.station.name}` : 'Not chosen yet'}</div>
            </div>
            <Link to="/find" className="link-btn">Change</Link>
          </section>
        )}
        <form className="card stack" onSubmit={save} noValidate>
          <h2>Your details</h2>
          <ErrorBox error={f.formError} />
          <Field label="Full name" id="pn" error={f.errors.fullName}><input id="pn" className="input" value={f.values.fullName} onChange={f.set('fullName')} /></Field>
          <Field label="Phone" id="pp" error={f.errors.phone}><input id="pp" className="input" type="tel" value={f.values.phone} onChange={f.set('phone')} /></Field>
          <button className="btn" disabled={f.busy}>Save</button>
        </form>
        <form className="card stack" onSubmit={changePw} noValidate>
          <h2>Change password</h2>
          <ErrorBox error={pw.formError} />
          <Field label="Current password" id="cp" error={pw.errors.currentPassword}><input id="cp" className="input" type="password" autoComplete="current-password" value={pw.values.currentPassword} onChange={pw.set('currentPassword')} /></Field>
          <Field label="New password" id="np" error={pw.errors.newPassword} hint="At least 8 characters, with a letter and a number"><input id="np" className="input" type="password" autoComplete="new-password" value={pw.values.newPassword} onChange={pw.set('newPassword')} /></Field>
          <button className="btn ghost" disabled={pw.busy}>Update password</button>
        </form>
        <button type="button" className="btn danger block" onClick={signOut}><Icon name="logout" size={17} />Sign out</button>
        <button type="button" className="link-btn center" style={{ color: 'var(--muted)' }} onClick={signOutAll}>Sign out on all devices</button>
      </main>
    </>
  );
}
