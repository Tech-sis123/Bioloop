import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth.jsx';
import { useApi } from '../../lib/hooks.js';
import { patch, post } from '../../lib/api.js';
import { ago, initials, kg, whenLabel } from '../../lib/format.js';
import Icon from '../../ui/Icon.jsx';
import { Empty, ErrorBox, Field, Sheet, Spinner, copyText, useForm, useToast } from '../../ui/kit.jsx';

const ROLE_LABEL = { resident: 'Resident', collector: 'Collector', recycler: 'Recycler', agency: 'Agency staff', admin: 'Admin' };

/* ---------- Collectors / Recyclers (organisations) ---------- */
export function Orgs({ kind }) {
  const { data, error, reload } = useApi(`/admin/orgs?kind=${kind}`);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const [invite, setInvite] = useState(null);
  const title = kind === 'collector' ? 'Collection companies' : 'Recycling partners';
  return (
    <>
      <header className="dash-head">
        <div><p className="muted">{kind === 'collector' ? 'Who empties the bins' : 'Who buys the sorted material'}</p><h1>{title}</h1></div>
        <button type="button" className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={17} />Add {kind === 'collector' ? 'company' : 'recycler'}</button>
      </header>
      <ErrorBox error={error} onRetry={reload} />
      {!data ? <Spinner /> : !data.orgs.length ? (
        <section className="card"><Empty icon={kind === 'collector' ? 'truck' : 'box'} title={`No ${kind === 'collector' ? 'collection companies' : 'recyclers'} yet`}>Add one, then invite its people so they can sign in.</Empty></section>
      ) : (
        <div className="dash-grid">
          {data.orgs.map((o) => (
            <section key={o.id} className="card stack-sm">
              <div className="row">
                <span className="avatar">{initials(o.name)}</span>
                <div className="grow"><div className="bold">{o.name}</div><div className="xs muted">{o.area || 'Any area'}{o.phone ? ` · ${o.phone}` : ''}</div></div>
              </div>
              {kind === 'collector' ? (
                <div className="row small muted wrap" style={{ gap: 14 }}><span><strong style={{ color: 'var(--ink)' }}>{o.stations}</strong> stations</span><span><strong style={{ color: 'var(--ink)' }}>{o.openPickups}</strong> open pickups</span><span><strong style={{ color: 'var(--ink)' }}>{o.doneWeek}</strong> done this week</span></div>
              ) : (
                <div className="row small muted"><span><strong style={{ color: 'var(--ink)' }}>{kg(o.reservedKg30d)}</strong> reserved in 30 days</span></div>
              )}
              <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
                <button type="button" className="btn ghost sm" onClick={() => setOpen(o)}><Icon name="users" size={15} />{o.members} {o.members === 1 ? 'person' : 'people'}</button>
                <button type="button" className="btn sm" onClick={() => setInvite({ role: kind, orgId: o.id, orgName: o.name })}><Icon name="plus" size={15} />Invite person</button>
              </div>
            </section>
          ))}
        </div>
      )}
      <OrgForm open={adding} kind={kind} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
      <Members org={open} onClose={() => setOpen(null)} />
      <InviteSheet preset={invite} onClose={() => setInvite(null)} onDone={reload} />
    </>
  );
}

function OrgForm({ open, kind, onClose, onDone }) {
  const f = useForm({ name: '', phone: '', area: '' });
  useEffect(() => { if (open) f.setValues({ name: '', phone: '', area: '' }); }, [open]); // eslint-disable-line
  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => { await post('/admin/orgs', { ...v, kind }); onDone(); });
  };
  return (
    <Sheet open={open} onClose={onClose} title={kind === 'collector' ? 'Add collection company' : 'Add recycler'} center>
      <form className="stack" onSubmit={submit} noValidate>
        <ErrorBox error={f.formError} />
        <Field label="Name" id="on" error={f.errors.name}><input id="on" className="input" value={f.values.name} onChange={f.set('name')} /></Field>
        <Field label="Phone" id="op" error={f.errors.phone} hint="Residents can call this number from the app"><input id="op" className="input" type="tel" value={f.values.phone} onChange={f.set('phone')} /></Field>
        <Field label="Area served" id="oa" error={f.errors.area}><input id="oa" className="input" placeholder="Akoka, Yaba" value={f.values.area} onChange={f.set('area')} /></Field>
        <button className="btn block" disabled={f.busy}>Add</button>
      </form>
    </Sheet>
  );
}

function Members({ org, onClose }) {
  const { data } = useApi(org ? `/admin/users?role=${org.kind}` : null);
  const list = (data?.users || []).filter((u) => u.orgId === org?.id);
  return (
    <Sheet open={!!org} onClose={onClose} title={org?.name || ''} center>
      {!data ? <Spinner /> : !list.length ? <Empty icon="users" title="Nobody yet">Use Invite person to add someone.</Empty> : list.map((u) => (
        <div key={u.id} className="card tight row" style={{ marginBottom: 8 }}>
          <span className="avatar" style={{ width: 38, height: 38, fontSize: 13 }}>{initials(u.fullName)}</span>
          <div className="grow"><div className="bold small">{u.fullName}</div><div className="xs muted">{u.email} · {u.lastLoginAt ? `seen ${ago(u.lastLoginAt)}` : 'not signed in yet'}</div></div>
          {!u.isActive && <span className="pill grey">Inactive</span>}
        </div>
      ))}
    </Sheet>
  );
}

/* ---------- Invite (create account) ---------- */
export function InviteSheet({ preset, onClose, onDone }) {
  const { user } = useAuth();
  const toast = useToast();
  const orgs = useApi(preset ? '/admin/orgs' : null);
  const f = useForm({});
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (preset) { f.setValues({ fullName: '', email: '', phone: '', role: preset.role || 'collector', orgId: preset.orgId || '' }); setResult(null); }
  }, [preset]); // eslint-disable-line
  const roles = user.role === 'admin' ? ['collector', 'recycler', 'resident', 'agency', 'admin'] : ['collector', 'recycler', 'resident'];
  const needsOrg = ['collector', 'recycler'].includes(f.values.role);
  const orgOptions = (orgs.data?.orgs || []).filter((o) => o.kind === f.values.role || (f.values.role === 'agency' && o.kind === 'agency'));
  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      const r = await post('/admin/users', { ...v, orgId: v.orgId || null });
      setResult(r);
      onDone?.();
    });
  };
  return (
    <Sheet open={!!preset} onClose={onClose} title={result ? 'Account created' : 'Invite person'} center>
      {result ? (
        <div className="stack">
          <div className="notice good"><Icon name="check" size={16} style={{ flexShrink: 0, marginTop: 1 }} /><span>{result.user.fullName} can now set a password. {result.emailed ? 'We emailed them the link.' : 'Send them this link by WhatsApp or SMS. It works once and expires in 1 hour.'}</span></div>
          <div className="code">{result.setupLink}</div>
          <button type="button" className="btn block" onClick={async () => toast((await copyText(result.setupLink)) ? 'Link copied' : 'Copy failed')}><Icon name="copy" size={17} />Copy setup link</button>
          <button type="button" className="btn ghost block" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {preset?.orgName && <p className="small muted">Joining {preset.orgName}</p>}
          <ErrorBox error={f.formError} />
          <Field label="Full name" id="if" error={f.errors.fullName}><input id="if" className="input" value={f.values.fullName || ''} onChange={f.set('fullName')} /></Field>
          <Field label="Email" id="ie" error={f.errors.email}><input id="ie" className="input" type="email" value={f.values.email || ''} onChange={f.set('email')} /></Field>
          <Field label="Phone" id="ip" error={f.errors.phone}><input id="ip" className="input" type="tel" value={f.values.phone || ''} onChange={f.set('phone')} /></Field>
          {!preset?.orgId && (
            <>
              <Field label="Role" id="ir" error={f.errors.role}>
                <select id="ir" className="input" value={f.values.role || ''} onChange={(e) => f.setValues((v) => ({ ...v, role: e.target.value, orgId: '' }))}>
                  {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </Field>
              {(needsOrg || f.values.role === 'agency') && (
                <Field label="Organisation" id="io" error={f.errors.orgId}>
                  <select id="io" className="input" value={f.values.orgId || ''} onChange={f.set('orgId')}>
                    <option value="">{needsOrg ? 'Choose...' : 'None'}</option>
                    {orgOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
          <button className="btn block big" disabled={f.busy}>Create account</button>
        </form>
      )}
    </Sheet>
  );
}

/* ---------- People ---------- */
export function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const { data, error, reload } = useApi(`/admin/users?${role ? `role=${role}&` : ''}${q ? `q=${encodeURIComponent(q)}` : ''}`);
  const [invite, setInvite] = useState(null);
  const [link, setLink] = useState(null);

  const canManage = (u) => me.role === 'admin' || !['agency', 'admin'].includes(u.role);
  const toggle = async (u) => {
    if (u.isActive && !window.confirm(`Deactivate ${u.fullName}? They will be signed out everywhere.`)) return;
    try { await patch(`/admin/users/${u.id}`, { isActive: !u.isActive }); toast(u.isActive ? 'Account deactivated' : 'Account reactivated'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const reset = async (u) => {
    try { const r = await post(`/admin/users/${u.id}/reset-link`); setLink({ user: u, link: r.link }); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <header className="dash-head">
        <div><p className="muted">Accounts and access</p><h1>People</h1></div>
        <button type="button" className="btn" onClick={() => setInvite({})}><Icon name="plus" size={17} />Invite person</button>
      </header>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="search" style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <Icon name="search" size={18} color="#52635A" />
          <input type="search" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        </label>
        <div role="group" className="filters">
          {[['', 'All'], ['resident', 'Residents'], ['collector', 'Collectors'], ['recycler', 'Recyclers'], ['agency', 'Agency'], ['admin', 'Admins']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={role === k} onClick={() => setRole(k)}>{l}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <section className="card">
        {!data ? <Spinner /> : !data.users.length ? <Empty icon="users" title="No one found" /> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Name</th><th>Role</th><th>Organisation / bin</th><th>Last sign in</th><th /></tr></thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.55 }}>
                    <td><div className="bold">{u.fullName}</div><div className="xs muted">{u.email}</div></td>
                    <td><span className={`pill ${u.role === 'admin' || u.role === 'agency' ? 'blue' : 'ok'}`}>{ROLE_LABEL[u.role]}</span></td>
                    <td className="small">{u.orgName || u.homeStationCode || '–'}{u.role === 'resident' ? ` · ${u.points} pts` : ''}</td>
                    <td className="small">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canManage(u) && u.id !== me.id && <>
                        <button type="button" className="link-btn" onClick={() => reset(u)}>Reset link</button>
                        <button type="button" className="link-btn" style={{ marginLeft: 10, color: u.isActive ? 'var(--orange)' : undefined }} onClick={() => toggle(u)}>{u.isActive ? 'Deactivate' : 'Reactivate'}</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <InviteSheet preset={invite} onClose={() => setInvite(null)} onDone={reload} />
      <Sheet open={!!link} onClose={() => setLink(null)} title="Password reset link" center>
        {link && (
          <div className="stack">
            <p className="small muted">Send this to {link.user.fullName}. It works once and expires in 1 hour.</p>
            <div className="code">{link.link}</div>
            <button type="button" className="btn block" onClick={async () => toast((await copyText(link.link)) ? 'Link copied' : 'Copy failed')}><Icon name="copy" size={17} />Copy link</button>
          </div>
        )}
      </Sheet>
    </>
  );
}

/* ---------- Reports ---------- */
export function Reports() {
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useApi(`/reports?status=${status}`, { interval: 30000 });
  const resolve = async (r) => {
    try { await post(`/reports/${r.id}/resolve`); toast('Marked as resolved'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <header className="dash-head">
        <div><p className="muted">From residents and sensors</p><h1>Problem reports</h1></div>
        <div role="group" className="filters">
          {[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, l]) => <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
      </header>
      <ErrorBox error={error} onRetry={reload} />
      {!data ? <Spinner /> : !data.reports.length ? <section className="card"><Empty icon="check" title="Nothing to fix">Reports from residents and device alerts land here.</Empty></section> : (
        <div className="stack">
          {data.reports.map((r) => (
            <section key={r.id} className={`card row ${r.status === 'open' ? 'warn' : ''}`} style={{ alignItems: 'flex-start' }}>
              <span className="alert-ico" style={{ background: '#FCE7D6' }}><Icon name="flag" size={18} color="#B4430D" /></span>
              <div className="grow stack-sm" style={{ gap: 4 }}>
                <div className="bold">{r.stationCode} · {r.categoryLabel}</div>
                {r.description && <div className="small">{r.description}</div>}
                <div className="xs muted">{r.reporterName || 'Sensor'} · {whenLabel(r.createdAt)}{r.resolvedAt ? ` · resolved ${ago(r.resolvedAt)}` : ''}</div>
              </div>
              {r.status === 'open' ? <button type="button" className="btn ghost sm" onClick={() => resolve(r)}>Resolve</button> : <span className="pill ok">Resolved</span>}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- Audit ---------- */
export function Audit() {
  const { data, error, reload } = useApi('/admin/audit');
  return (
    <>
      <header className="dash-head"><div><p className="muted">Security-relevant actions, newest first</p><h1>Audit log</h1></div></header>
      <ErrorBox error={error} onRetry={reload} />
      <section className="card">
        {!data ? <Spinner /> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
              <tbody>
                {data.entries.map((a) => (
                  <tr key={a.id}>
                    <td className="small">{whenLabel(a.at)}</td>
                    <td className="small">{a.actorName || '–'}</td>
                    <td><code className="xs">{a.action}</code></td>
                    <td className="xs muted">{a.entity ? `${a.entity} ${String(a.entityId || '').slice(0, 8)}` : ''}</td>
                    <td className="xs muted">{a.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
