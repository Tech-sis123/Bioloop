import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api.js';

// Fetch a GET endpoint, optionally polling. Polling pauses when the tab is hidden
// so phones do not burn data in the background.
export function useApi(path, { interval = 0, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!!path && enabled);
  const alive = useRef(true);

  const load = useCallback(async (quiet = false) => {
    if (!path || !enabled) return;
    if (!quiet) setLoading(true);
    try {
      const d = await get(path);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    alive.current = true;
    load();
    if (!interval) return () => { alive.current = false; };
    const tick = () => { if (document.visibilityState === 'visible') load(true); };
    const t = setInterval(tick, interval);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive.current = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, interval]);

  return { data, error, loading, reload: () => load(true), setData };
}
