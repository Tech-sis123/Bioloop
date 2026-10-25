import { useEffect, useRef, useState } from 'react';
import { mountBin, mountLoop, webglAvailable } from './scenes.js';

// Mounts a 3D scene into a div. Falls back to `fallback` when WebGL is missing.
export default function Scene3D({ kind = 'bin', mode = 'hero', className, onTick, fallback = null, label }) {
  const ref = useRef(null);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  const [ok, setOk] = useState(true);

  useEffect(() => {
    if (!ref.current) return undefined;
    if (!webglAvailable()) { setOk(false); return undefined; }
    let cleanup = () => {};
    try {
      cleanup = kind === 'loop'
        ? mountLoop(ref.current)
        : mountBin(ref.current, { mode, onTick: (s) => tickRef.current?.(s) });
    } catch {
      setOk(false);
    }
    return () => cleanup();
  }, [kind, mode]);

  if (!ok) return fallback;
  return <div ref={ref} className={className} role="img" aria-label={label} />;
}
