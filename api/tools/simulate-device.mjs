#!/usr/bin/env node
// BioLoop device simulator. Pretends to be a station so you can test the whole
// system before (or without) real hardware.
//
//   node tools/simulate-device.mjs --url https://YOUR-API.onrender.com --key blk_xxxxxxxx_yyyy
//
// Options:
//   --url       API base URL (default http://localhost:4000)
//   --key       Device key from the dashboard (or env BIOLOOP_DEVICE_KEY)
//   --interval  Seconds between reports (default 5 for quick testing)
//   --count     Stop after N reports (default: run forever)
//   --mode      fill (bins fill up then get emptied) | once (single report) | distance (send raw cm)

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, [])
);

const url = (args.url || process.env.BIOLOOP_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const key = args.key || process.env.BIOLOOP_DEVICE_KEY;
const interval = Number(args.interval || 5) * 1000;
const count = args.count ? Number(args.count) : Infinity;
const mode = args.mode || 'fill';

if (!key) {
  console.error('Missing --key. Create a station in the dashboard and copy its device key.');
  process.exit(1);
}

const state = {
  general: { fill: 20, rate: 4, locked: false },
  recyclable: { fill: 35, rate: 6, locked: false },
  organic: { fill: 55, rate: 9, locked: false },
};
let battery = 92;

async function call(path, body) {
  const res = await fetch(url + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'BioLoop-Sim/1.0' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json?.error?.message || res.statusText}`);
  return json;
}

function step() {
  for (const [stream, s] of Object.entries(state)) {
    if (s.locked) continue; // nobody can add waste to a locked compartment
    s.fill = Math.min(100, s.fill + Math.random() * s.rate);
  }
  battery = Math.max(5, battery - 0.2);
}

// Distance mode: 60 cm deep bin, sensor reads 8 cm when full
const toDistance = (fill) => Math.round((60 - (fill / 100) * 52) * 10) / 10;

async function report(n) {
  const body = {
    fw: 'sim-1.0.0',
    battery: Math.round(battery),
    rssi: -60 - Math.round(Math.random() * 20),
    solar_v: 5.1,
    compartments: Object.entries(state).map(([stream, s]) =>
      mode === 'distance'
        ? { stream, distance_cm: toDistance(s.fill), lid_locked: s.locked }
        : { stream, fill_pct: Math.round(s.fill), lid_locked: s.locked }
    ),
  };
  const res = await call('/api/v1/device/telemetry', body);
  for (const c of res.compartments) state[c.stream].locked = res.lock[c.stream];
  const line = res.compartments.map((c) => `${c.stream.padEnd(10)} ${String(c.fill_pct).padStart(3)}% ${c.lock ? 'LOCKED' : 'open  '}`).join(' | ');
  console.log(`#${n} ${res.station} ${line}`);

  // Simulate a collector emptying a locked compartment a few reports later
  for (const s of Object.values(state)) {
    if (s.locked && Math.random() < 0.25) s.fill = 3;
  }
  return res;
}

(async () => {
  console.log(`Connecting to ${url} ...`);
  const cfg = await call('/api/v1/device/config');
  console.log(`Authenticated as ${cfg.station} (${cfg.name}). Server says report every ${cfg.next_report_s}s; simulator uses ${interval / 1000}s.`);
  if (mode === 'once') {
    await report(1);
    return;
  }
  for (let n = 1; n <= count; n++) {
    try {
      await report(n);
    } catch (err) {
      console.error(`#${n} failed: ${err.message}`);
    }
    step();
    if (n < count) await new Promise((r) => setTimeout(r, interval));
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
