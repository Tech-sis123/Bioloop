// API client. The access token lives only in memory (never localStorage) and
// the refresh token is an httpOnly cookie the browser handles for us.
// On a 401 we refresh once and retry; parallel requests share one refresh.

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/api/v1';

let accessToken = null;
let refreshing = null;
let onSessionEnd = () => {};

export const setAccessToken = (t) => { accessToken = t; };
export const setSessionEndHandler = (fn) => { onSessionEnd = fn; };

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.fields = body?.error?.fields || {};
  }
}

async function raw(path, { method = 'GET', body, headers = {} } = {}) {
  return fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'X-Requested-With': 'bioloop',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function refreshSession() {
  if (!refreshing) {
    refreshing = (async () => {
      const res = await raw('/auth/refresh', { method: 'POST' });
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const data = await res.json();
      accessToken = data.accessToken;
      return data;
    })().finally(() => setTimeout(() => { refreshing = null; }, 0));
  }
  return refreshing;
}

export async function api(path, opts = {}) {
  let res;
  try {
    res = await raw(path, opts);
  } catch {
    throw new ApiError(0, { error: { message: 'You seem to be offline. Check your connection and try again.' } });
  }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const ok = await refreshSession();
    if (ok) res = await raw(path, opts);
    else {
      onSessionEnd();
      throw new ApiError(401, { error: { message: 'Please sign in again' } });
    }
  }
  if (opts.raw) return res;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const patch = (p, body = {}) => api(p, { method: 'PATCH', body });

// Download a file (CSV export) with auth
export async function download(path, filename) {
  const res = await api(path, { raw: true });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
