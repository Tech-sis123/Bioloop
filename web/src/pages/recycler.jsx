import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/hooks.js';
import { post } from '../lib/api.js';
import { kg, whenLabel } from '../lib/format.js';
import Icon from '../ui/Icon.jsx';
import { AlertsButton, Empty, ErrorBox, Sheet, Spinner, useToast, useUnread } from '../ui/kit.jsx';

const ICON = { pet: 'bottle', hdpe: 'cup', nylon: 'layers', paper: 'layers', metal: 'cup', glass: 'bottle', organic: 'leaf', mixed: 'recycle' };
const GROUPS = [['plastics', 'Plastics'], ['paper', 'Paper'], ['metal', 'Metal'], ['organic', 'Organic'], ['all', 'All']];

export function RecyclerMarket() {
  const { user } = useAuth();
  const unread = useUnread();
  const toast = useToast();
  const [group, setGroup] = useState('plastics');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const market = useApi(`/batches?group=${group}${dq ? `&q=${encodeURIComponent(dq)}` : ''}`, { interval: 30000 });
  const mine = useApi('/batches/mine', { interval: 60000 });

  const reserve = async (m) => {
    setBusy(m.material);
    try {
      const r = await post('/batches/reserve-material', { material: m.material });
      toast(`Reserved ${kg(r.weightKg)} of ${m.materialLabel}`);
      setDetail(null);
      market.reload();
      mine.reload();
    } catch (e) { toast(e.message, 'error'); market.reload(); } finally { setBusy(null); }
  };

  const weeks = mine.data?.weeks || [];
  const maxWeek = Math.max(1, ...weeks.map((w) => w.kg));

  return (
    <>
      <header className="topbar" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <p className="small muted truncate">{user.orgName || 'No company linked'} · Recycler</p>
          <h1 className="page-title md" style={{ marginTop: 2 }}>Sorted materials near you</h1>
        </div>
        <AlertsButton unread={unread} />
      </header>
      <main className="page" style={{ gap: 12 }}>
        {!user.orgId && <div className="notice">Your account is not linked to a recycling company yet. Ask your BioLoop admin to add you.</div>}
        <label className="search">
          <Icon name="search" size={18} color="#52635A" />
          <span className="sr-only">Search materials or area</span>
          <input type="search" placeholder="Search material or area" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div role="group" aria-label="Material type" className="filters blue">
          {GROUPS.map(([k, l]) => <button key={k} type="button" aria-pressed={group === k} onClick={() => setGroup(k)}>{l}</button>)}
        </div>

        <section aria-label="Your week" className="row" style={{ gap: 14, background: 'var(--blue-soft)', borderRadius: 20, padding: '14px 16px' }}>
          <div className="grow">
            <div className="small bold" style={{ color: 'var(--blue-text)' }}>Reserved this week</div>
            <div className="num" style={{ fontSize: 28, lineHeight: 1.1, color: '#10314F' }}>{kg(mine.data?.weekKg)}</div>
          </div>
          <div className="row" style={{ alignItems: 'flex-end', gap: 5, height: 44 }} aria-hidden="true">
            {(weeks.length ? weeks : [{ kg: 0 }, { kg: 0 }, { kg: 0 }, { kg: 0 }, { kg: 0 }]).map((w, i, arr) => (
              <span key={i} style={{ width: 10, height: `${Math.max(8, (w.kg / maxWeek) * 100)}%`, borderRadius: 4, background: i === arr.length - 1 ? '#255F9A' : '#9BBCE0' }} />
            ))}
          </div>
        </section>

        <ErrorBox error={market.error} onRetry={market.reload} />
        {!market.data ? <Spinner /> : !market.data.materials.length ? (
          <Empty icon="box" title="Nothing available right now">Batches appear here as collectors empty sorted compartments.</Empty>
        ) : market.data.materials.map((m) => (
          <article key={m.material} className="card stack" style={{ gap: 12 }}>
            <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
              <span className="swatch" style={{ width: 46, height: 46, borderRadius: 14, background: m.material === 'organic' ? '#DDEEE2' : '#DCE8F5' }}>
                <Icon name={ICON[m.material]} size={22} color={m.material === 'organic' ? '#1F6B45' : '#255F9A'} />
              </span>
              <div className="grow">
                <h2 style={{ fontSize: 16 }}>{m.materialLabel}</h2>
                <p className="small muted" style={{ marginTop: 2 }}>{[m.stationCount ? `${m.stationCount} station${m.stationCount === 1 ? '' : 's'}` : null, m.areas.length ? m.areas.slice(0, 2).join(' and ') : null, 'Sorted at source'].filter(Boolean).join(' · ')}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ fontSize: 22 }}>{kg(m.weightKg)}</div>
                <div className="xs muted">ready</div>
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn dark grow" disabled={!user.orgId || busy === m.material} onClick={() => reserve(m)}>{busy === m.material ? 'Reserving...' : 'Reserve batch'}</button>
                <button type="button" className="btn ghost" onClick={() => setDetail(m)}>Details</button>
            </div>
          </article>
        ))}
      </main>
      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail?.materialLabel || ''}>
        {detail && (
          <div className="stack">
            <p className="small muted">{detail.batches.length} batch{detail.batches.length === 1 ? '' : 'es'} · {kg(detail.weightKg)} total</p>
            {detail.batches.map((b) => (
              <div key={b.id} className="card tight row">
                <div className="grow">
                  <div className="bold small">{b.stationCode ? `${b.stationCode} · ${b.stationName}` : b.area || 'Listed by agency'}</div>
                  <div className="xs muted">Collected {whenLabel(b.createdAt)}</div>
                </div>
                <strong>{kg(b.weightKg)}</strong>
              </div>
            ))}
            <button type="button" className="btn dark block big" disabled={!user.orgId || busy} onClick={() => reserve(detail)}>Reserve all {kg(detail.weightKg)}</button>
          </div>
        )}
      </Sheet>
    </>
  );
}

export function RecyclerOrders() {
  const unread = useUnread();
  const toast = useToast();
  const { data, error, reload } = useApi('/batches/mine', { interval: 30000 });
  const act = async (b, action) => {
    try {
      await post(`/batches/${b.id}/${action}`);
      toast(action === 'collected' ? 'Marked as collected' : 'Released back to the market');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const reserved = (data?.batches || []).filter((b) => b.status === 'reserved');
  const done = (data?.batches || []).filter((b) => b.status === 'collected');
  return (
    <>
      <header className="topbar">
        <h1 className="page-title md">Orders</h1>
        <AlertsButton unread={unread} />
      </header>
      <main className="page" style={{ gap: 12 }}>
        <ErrorBox error={error} onRetry={reload} />
        {!data ? <Spinner /> : !data.batches.length ? <Empty icon="box" title="No reservations yet">Reserve a batch from the market and it will show here.</Empty> : (
          <>
            {reserved.length > 0 && <h2 className="eyebrow">Waiting for collection</h2>}
            {reserved.map((b) => (
              <div key={b.id} className="card stack-sm">
                <div className="row between"><strong>{b.materialLabel}</strong><strong>{kg(b.weightKg)}</strong></div>
                <div className="xs muted">{b.stationCode ? `${b.stationCode} · ${b.stationName}` : b.area} · reserved {whenLabel(b.reservedAt)}</div>
                <div className="choice-grid two" style={{ marginTop: 6 }}>
                  <button type="button" className="btn ghost sm" onClick={() => act(b, 'release')}>Release</button>
                  <button type="button" className="btn blue sm" onClick={() => act(b, 'collected')}>Collected</button>
                </div>
              </div>
            ))}
            {done.length > 0 && <h2 className="eyebrow" style={{ marginTop: 6 }}>Collected</h2>}
            {done.map((b) => (
              <div key={b.id} className="card tight row">
                <div className="grow"><div className="bold small">{b.materialLabel}</div><div className="xs muted">{whenLabel(b.collectedAt)}</div></div>
                <span className="pill blue">{kg(b.weightKg)}</span>
              </div>
            ))}
          </>
        )}
      </main>
    </>
  );
}
