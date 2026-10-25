import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import Icon, { LogoMark } from './Icon.jsx';
import { STREAM } from '../lib/format.js';
import { useApi } from '../lib/hooks.js';

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, tone = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- Layout bits ---------- */
export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="BioLoop home">
      <LogoMark />
      <span>BioLoop</span>
    </Link>
  );
}

export function AlertsButton({ unread }) {
  return (
    <Link to="/alerts" className="icon-btn" aria-label={unread ? `Alerts, ${unread} new` : 'Alerts'}>
      <Icon name="bell" />
      {unread > 0 && <span className="badge-dot" />}
    </Link>
  );
}

export function BackHeader({ title, subtitle, to, right }) {
  const nav = useNavigate();
  return (
    <header className="topbar back">
      <button type="button" className="icon-btn" aria-label="Back" onClick={() => (to ? nav(to) : nav(-1))}>
        <Icon name="back" />
      </button>
      <div className="grow">
        <h1 className="page-title sm truncate">{title}</h1>
        {subtitle && <p className="small muted truncate" style={{ marginTop: 2 }}>{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function useUnread() {
  const { data } = useApi('/notifications/unread-count', { interval: 30000 });
  return data?.unread || 0;
}

export function BottomNav({ items, blue }) {
  return (
    <nav aria-label="Main" className={`bottom-nav ${blue ? 'blue' : ''}`}>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name={it.icon} size={22} />
          {it.label}
          {it.count > 0 && <span className="count">{it.count > 9 ? '9+' : it.count}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

/* ---------- Atoms ---------- */
export function Spinner() {
  return <div className="loading"><div className="spinner" aria-label="Loading" /></div>;
}

export function Empty({ icon = 'leaf', title, children, action }) {
  return (
    <div className="empty">
      <span className="ico"><Icon name={icon} color="#1F6B45" size={24} /></span>
      {title && <div className="bold" style={{ color: 'var(--ink)', fontSize: 15 }}>{title}</div>}
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="notice" role="alert">
      <Icon name="info" size={16} color="#B4430D" style={{ flexShrink: 0, marginTop: 1 }} />
      <span className="grow">{error.message}</span>
      {onRetry && <button type="button" className="link-btn" style={{ padding: 0, color: 'var(--orange)' }} onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function StreamSwatch({ stream, size = 34 }) {
  const s = STREAM[stream];
  return (
    <span className="swatch" style={{ background: s.soft, width: size, height: size }}>
      <i style={{ background: s.color }} />
    </span>
  );
}

export function StreamTag({ stream }) {
  return <span className="stream-tag"><i style={{ background: STREAM[stream].color }} />{STREAM[stream].label}</span>;
}

export function Bar({ value, color, thin }) {
  return <div className={`bar ${thin ? 'thin' : ''}`}><div style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></div>;
}

export function Field({ label, error, hint, children, id }) {
  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}</label>}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/* ---------- Sheet ---------- */
export function Sheet({ open, onClose, title, children, wide, center }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={`sheet-backdrop ${center ? 'center' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 className="page-title sm">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const run = async (fn) => {
    setBusy(true); setErrors({}); setFormError(null);
    try {
      return await fn(values);
    } catch (e) {
      setErrors(e.fields || {});
      if (!e.fields || !Object.keys(e.fields).length) setFormError(e);
      else setFormError(null);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { values, setValues, set, errors, busy, formError, run };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
