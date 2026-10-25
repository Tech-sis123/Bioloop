import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { post } from '../lib/api.js';
import { ErrorBox, Field, useForm } from '../ui/kit.jsx';
import Icon, { LogoMark } from '../ui/Icon.jsx';

function Shell({ title, sub, children }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <Link to="/welcome" className="auth-back"><Icon name="back" size={18} />BioLoop home</Link>
        <div className="auth-hero">
          <svg className="rings" width="200" height="200" viewBox="0 0 30 30" aria-hidden="true">
            <circle cx="11" cy="15" r="7.5" fill="none" stroke="#7CE3A3" strokeWidth="2" />
            <circle cx="19" cy="15" r="7.5" fill="none" stroke="#A9BBFF" strokeWidth="2" />
          </svg>
          <div className="row" style={{ marginBottom: 18 }}>
            <LogoMark a="#7CE3A3" b="#A9BBFF" />
            <span className="display" style={{ fontSize: 21 }}>BioLoop</span>
          </div>
          <h1 className="display" style={{ fontSize: 28 }}>{title}</h1>
          {sub && <p style={{ marginTop: 6, color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const f = useForm({ email: '', password: '' });
  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      await login(v.email, v.password);
      nav('/', { replace: true });
    });
  };
  return (
    <Shell title="Welcome back" sub="Sign in to see your bins, pickups and points.">
      <form className="stack" onSubmit={submit} noValidate>
        <ErrorBox error={f.formError} />
        <Field label="Email" id="email" error={f.errors.email}>
          <input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={f.values.email} onChange={f.set('email')} required />
        </Field>
        <Field label="Password" id="password" error={f.errors.password}>
          <input id="password" className="input" type="password" autoComplete="current-password" value={f.values.password} onChange={f.set('password')} required />
        </Field>
        <button className="btn block big" disabled={f.busy}>{f.busy ? 'Signing in...' : 'Sign in'}</button>
        <div className="row between small">
          <Link to="/forgot-password">Forgot password?</Link>
          <Link to="/register" className="bold">Create an account</Link>
        </div>
      </form>
    </Shell>
  );
}

export function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const f = useForm({ fullName: '', email: '', phone: '', password: '', stationCode: params.get('station') || '' });
  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      await register(v);
      nav('/', { replace: true });
    });
  };
  return (
    <Shell title="Join BioLoop" sub="Know when your bin is full, and earn Loop points for sorting.">
      <form className="stack" onSubmit={submit} noValidate>
        <ErrorBox error={f.formError} />
        <Field label="Full name" id="fullName" error={f.errors.fullName}>
          <input id="fullName" className="input" autoComplete="name" value={f.values.fullName} onChange={f.set('fullName')} />
        </Field>
        <Field label="Email" id="email" error={f.errors.email}>
          <input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={f.values.email} onChange={f.set('email')} />
        </Field>
        <Field label="Phone (optional)" id="phone" error={f.errors.phone}>
          <input id="phone" className="input" type="tel" autoComplete="tel" placeholder="+234" value={f.values.phone} onChange={f.set('phone')} />
        </Field>
        <Field label="Password" id="password" error={f.errors.password} hint="At least 8 characters, with a letter and a number">
          <input id="password" className="input" type="password" autoComplete="new-password" value={f.values.password} onChange={f.set('password')} />
        </Field>
        <Field label="Your bin code (optional)" id="stationCode" error={f.errors.stationCode} hint="It is printed on the station, like BL-049. You can add it later.">
          <input id="stationCode" className="input" autoCapitalize="characters" placeholder="BL-049" value={f.values.stationCode} onChange={f.set('stationCode')} />
        </Field>
        <button className="btn block big" disabled={f.busy}>{f.busy ? 'Creating account...' : 'Create account'}</button>
        <p className="small center muted">Already have an account? <Link to="/login" className="bold">Sign in</Link></p>
      </form>
    </Shell>
  );
}

export function ForgotPassword() {
  const f = useForm({ email: '' });
  const [sent, setSent] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      const r = await post('/auth/forgot-password', v);
      setSent(r.message);
    });
  };
  return (
    <Shell title="Reset password" sub="We will email you a link to set a new one.">
      {sent ? (
        <div className="stack">
          <div className="notice good">{sent}</div>
          <p className="small muted">No email? Your BioLoop admin can also send you a reset link.</p>
          <Link to="/login" className="btn block ghost">Back to sign in</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <ErrorBox error={f.formError} />
          <Field label="Email" id="email" error={f.errors.email}>
            <input id="email" className="input" type="email" autoComplete="email" value={f.values.email} onChange={f.set('email')} />
          </Field>
          <button className="btn block big" disabled={f.busy}>Send reset link</button>
          <Link to="/login" className="small center">Back to sign in</Link>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') || '';
  const f = useForm({ password: '', confirm: '' });
  const [done, setDone] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    f.run(async (v) => {
      if (v.password !== v.confirm) {
        const err = new Error('Passwords do not match');
        err.fields = { confirm: 'Passwords do not match' };
        throw err;
      }
      await post('/auth/reset-password', { token, password: v.password });
      setDone(true);
      setTimeout(() => nav('/login'), 1800);
    });
  };
  return (
    <Shell title="Set your password" sub="Choose a password you have not used elsewhere.">
      {!token ? (
        <div className="notice">This link is missing its token. Open the link from your email again.</div>
      ) : done ? (
        <div className="notice good">Password set. Taking you to sign in...</div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <ErrorBox error={f.formError} />
          <Field label="New password" id="pw" error={f.errors.password} hint="At least 8 characters, with a letter and a number">
            <input id="pw" className="input" type="password" autoComplete="new-password" value={f.values.password} onChange={f.set('password')} />
          </Field>
          <Field label="Confirm password" id="pw2" error={f.errors.confirm}>
            <input id="pw2" className="input" type="password" autoComplete="new-password" value={f.values.confirm} onChange={f.set('confirm')} />
          </Field>
          <button className="btn block big" disabled={f.busy}>Save password</button>
        </form>
      )}
    </Shell>
  );
}
