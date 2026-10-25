import { useState } from 'react';
import { useApi } from '../../lib/hooks.js';
import { post } from '../../lib/api.js';
import { ago, duration, kg, timeOf, whenLabel } from '../../lib/format.js';
import { Empty, ErrorBox, Sheet, Spinner, StreamTag, useToast } from '../../ui/kit.jsx';

export function PickupStatus({ p }) {
  if (p.status === 'en_route') return <span className="pill ok">En route{p.eta ? ` · ${timeOf(p.eta)}` : ''}</span>;
  if (p.status === 'completed') return <span className="pill blue">Done</span>;
  if (p.status === 'cancelled') return <span className="pill grey">Cancelled</span>;
  if (p.locked) return <span className="pill locked">Locked {duration(p.requestedAt)}</span>;
  if (!p.collectorOrgId) return <span className="pill near">Unassigned</span>;
  return <span className="pill near">Near full</span>;
}

export function AssignSheet({ pickup, onClose, onDone }) {
  const toast = useToast();
  const orgs = useApi(pickup ? '/admin/orgs?kind=collector' : null);
  const assign = async (org) => {
    try {
      await post(`/pickups/${pickup.id}/assign`, { orgId: org.id });
      toast(`Assigned to ${org.name}`);
      onDone?.();
      onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Sheet open={!!pickup} onClose={onClose} title="Assign collector" center>
      {pickup && (
        <div className="stack">
          <p className="small muted">{pickup.stationCode} · {pickup.stationName}</p>
          {!orgs.data ? <Spinner /> : !orgs.data.orgs.length ? <Empty icon="truck" title="No collection companies yet">Add one under Collectors first.</Empty> : orgs.data.orgs.map((o) => (
            <button key={o.id} type="button" className="card tight row" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => assign(o)}>
              <div className="grow"><div className="bold">{o.name}</div><div className="xs muted">{o.area || 'Any area'} · {o.openPickups} open · {o.members} people</div></div>
              <span className="link-btn">Assign</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export default function Pickups() {
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useApi(`/pickups?status=${status}&days=30`, { interval: status === 'open' ? 20000 : 0 });
  const [assign, setAssign] = useState(null);
  const [complete, setComplete] = useState(null);
  const [weight, setWeight] = useState('');

  const cancel = async (p) => {
    if (!window.confirm(`Cancel the ${p.stream} pickup at ${p.stationCode}?`)) return;
    try { await post(`/pickups/${p.id}/cancel`); toast('Pickup cancelled'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const doComplete = async () => {
    try {
      await post(`/pickups/${complete.id}/complete`, weight ? { weightKg: Number(weight) } : {});
      toast('Marked as emptied');
      setComplete(null); setWeight(''); reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <header className="dash-head">
        <div><p className="muted">Collection requests</p><h1>Pickups</h1></div>
        <div role="group" className="filters">
          {[['open', 'Open'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All (30 days)']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
      </header>
      <ErrorBox error={error} onRetry={reload} />
      <section className="card">
        {!data ? <Spinner /> : !data.pickups.length ? <Empty icon="truck" title="No pickups here">Bins request pickups automatically when they reach the near-full level.</Empty> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Station</th><th>Stream</th><th>Fill</th><th>Collector</th><th>Requested</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.pickups.map((p) => (
                  <tr key={p.id}>
                    <td><div className="bold">{p.stationCode}</div><div className="xs muted">{p.stationName}</div></td>
                    <td><StreamTag stream={p.stream} /></td>
                    <td className="bold">{p.status === 'completed' ? (p.weightKg ? kg(p.weightKg) : '–') : `${p.currentFill ?? p.fillAtRequest ?? '?'}%`}</td>
                    <td>{p.collectorOrgName || <span style={{ color: '#8A3409', fontWeight: 600 }}>Unassigned</span>}</td>
                    <td className="small">{p.status === 'completed' ? whenLabel(p.completedAt) : ago(p.requestedAt)}<div className="xs muted">{p.source === 'manual' ? 'Manual' : 'Sensor'}</div></td>
                    <td><PickupStatus p={p} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {['pending', 'assigned'].includes(p.status) && <button type="button" className="link-btn" onClick={() => setAssign(p)}>{p.collectorOrgId ? 'Reassign' : 'Assign'}</button>}
                      {['pending', 'assigned', 'en_route'].includes(p.status) && <>
                        <button type="button" className="link-btn" style={{ marginLeft: 10 }} onClick={() => setComplete(p)}>Emptied</button>
                        <button type="button" className="link-btn" style={{ marginLeft: 10, color: 'var(--orange)' }} onClick={() => cancel(p)}>Cancel</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <AssignSheet pickup={assign} onClose={() => setAssign(null)} onDone={reload} />
      <Sheet open={!!complete} onClose={() => setComplete(null)} title="Mark as emptied" center>
        {complete && (
          <div className="stack">
            <p className="small muted">{complete.stationCode} · {complete.stream}. Use this when a collector confirms by phone.</p>
            <input className="input" type="number" min="0" step="0.1" placeholder="Weight in kg (optional)" value={weight} onChange={(e) => setWeight(e.target.value)} />
            <button type="button" className="btn block" onClick={doComplete}>Confirm</button>
          </div>
        )}
      </Sheet>
    </>
  );
}
