// End-to-end test against a running API + database.
//   API_URL=http://localhost:4000 ADMIN_EMAIL=... ADMIN_PASSWORD=... npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = (process.env.API_URL || 'http://localhost:4000') + '/api/v1';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@bioloop.test', password: process.env.ADMIN_PASSWORD || 'Str0ngAdminPass' };
const run = Date.now().toString(36);

async function http(method, path, { token, body, cookie, device, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(device ? { Authorization: `Bearer ${device}` } : {}),
      ...(cookie ? { Cookie: cookie, 'X-Requested-With': 'bioloop' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

const login = async (email, password) => {
  const r = await http('POST', '/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { token: r.json.accessToken, cookie: r.setCookie.split(';')[0], user: r.json.user };
};

// Create an account through the admin API and finish setup through the reset link
async function makeUser(adminToken, data) {
  const r = await http('POST', '/admin/users', { token: adminToken, body: data });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const token = new URL(r.json.setupLink).searchParams.get('token');
  const set = await http('POST', '/auth/reset-password', { body: { token, password: 'Collect0r!pass' } });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  return login(data.email, 'Collect0r!pass');
}

test('full BioLoop flow', async (t) => {
  const admin = await login(ADMIN.email, ADMIN.password);
  let station, deviceKey, collector, resident, recycler, collectorOrg, recyclerOrg;

  await t.test('security basics', async () => {
    assert.equal((await http('GET', '/stations')).status, 401);
    assert.equal((await http('GET', '/admin/overview', { token: 'nonsense' })).status, 401);
    const bad = await http('POST', '/auth/login', { body: { email: ADMIN.email, password: 'wrong-password1' } });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error.message, 'Email or password is incorrect');
    const unknown = await http('POST', '/auth/login', { body: { email: 'nobody@nowhere.test', password: 'wrong-password1' } });
    assert.equal(unknown.json.error.message, bad.json.error.message);
    // Refresh needs the CSRF header
    const noHeader = await fetch(API + '/auth/refresh', { method: 'POST', headers: { Cookie: admin.cookie } });
    assert.equal(noHeader.status, 403);
    // Register cannot pick a role
    const reg = await http('POST', '/auth/register', { body: { fullName: 'Sneaky', email: `sneaky-${run}@t.test`, password: 'Passw0rd!x', role: 'admin' } });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.user.role, 'resident');
    const weak = await http('POST', '/auth/register', { body: { fullName: 'Weak', email: `weak-${run}@t.test`, password: 'password' } });
    assert.equal(weak.status, 400);
  });

  await t.test('refresh token rotation and reuse detection', async () => {
    const s = await login(ADMIN.email, ADMIN.password);
    const r1 = await http('POST', '/auth/refresh', { cookie: s.cookie });
    assert.equal(r1.status, 200);
    const c2 = r1.setCookie.split(';')[0];
    // Replaying the old cookie kills the family
    const replay = await http('POST', '/auth/refresh', { cookie: s.cookie });
    assert.equal(replay.status, 401);
    const after = await http('POST', '/auth/refresh', { cookie: c2 });
    assert.equal(after.status, 401, 'rotated token should be revoked after reuse');
  });

  await t.test('orgs and station provisioning', async () => {
    const orgs = await http('GET', '/admin/orgs', { token: admin.token });
    collectorOrg = orgs.json.orgs.find((o) => o.kind === 'collector');
    recyclerOrg = orgs.json.orgs.find((o) => o.kind === 'recycler');
    assert.ok(collectorOrg && recyclerOrg, 'demo orgs exist');
    const code = `T-${run}`.toUpperCase().slice(0, 20);
    const r = await http('POST', '/stations', {
      token: admin.token,
      body: { code, name: 'Test bin point', area: 'Akoka', lat: 6.51, lng: 3.39, collectorOrgId: collectorOrg.id, reportIntervalS: 60 },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    station = r.json.station;
    deviceKey = r.json.deviceKey;
    assert.match(deviceKey, /^blk_[a-f0-9]{8}_/);
    assert.equal(station.compartments.length, 3);
  });

  await t.test('accounts for each role', async () => {
    collector = await makeUser(admin.token, { fullName: 'Tunde Collector', email: `col-${run}@t.test`, role: 'collector', orgId: collectorOrg.id });
    recycler = await makeUser(admin.token, { fullName: 'Ada Recycler', email: `rec-${run}@t.test`, role: 'recycler', orgId: recyclerOrg.id });
    const reg = await http('POST', '/auth/register', { body: { fullName: 'Amaka Resident', email: `res-${run}@t.test`, password: 'Resid3nt!pass', stationCode: station.code } });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    resident = { token: reg.json.accessToken, user: reg.json.user };
    // Roles cannot reach each other's endpoints
    assert.equal((await http('GET', '/admin/overview', { token: resident.token })).status, 403);
    assert.equal((await http('GET', '/pickups', { token: resident.token })).status, 403);
    assert.equal((await http('GET', '/batches', { token: collector.token })).status, 403);
    assert.equal((await http('POST', '/stations', { token: collector.token, body: { code: 'X-1', name: 'x' } })).status, 403);
  });

  await t.test('device auth', async () => {
    assert.equal((await http('GET', '/device/config', { device: 'blk_00000000_fake' })).status, 401);
    const cfg = await http('GET', '/device/config', { device: deviceKey });
    assert.equal(cfg.status, 200);
    assert.equal(cfg.json.station, station.code);
    const bad = await http('POST', '/device/telemetry', { device: deviceKey, body: { compartments: [{ stream: 'plastic', fill_pct: 10 }] } });
    assert.equal(bad.status, 400);
  });

  await t.test('telemetry: near full creates pickup, full locks, resident notified', async () => {
    let r = await http('POST', '/device/telemetry', { device: deviceKey, body: { battery: 86, rssi: -70, fw: '1.0.0', compartments: [
      { stream: 'general', fill_pct: 42 }, { stream: 'recyclable', distance_cm: 24.6 }, { stream: 'organic', fill_pct: 60 },
    ] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.lock.organic, false);
    // 60 - 24.6 = 35.4 of 52 cm => 68%
    assert.equal(r.json.compartments.find((c) => c.stream === 'recyclable').fill_pct, 68);

    r = await http('POST', '/device/telemetry', { device: deviceKey, body: { compartments: [{ stream: 'organic', fill_pct: 91 }] } });
    assert.equal(r.json.lock.organic, true);

    const pk = await http('GET', '/pickups', { token: collector.token });
    const mine = pk.json.pickups.filter((p) => p.stationId === station.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].stream, 'organic');
    assert.equal(mine[0].status, 'assigned');
    assert.equal(mine[0].locked, true);

    const n = await http('GET', '/notifications', { token: resident.token });
    assert.ok(n.json.notifications.some((x) => x.kind === 'locked'), 'resident sees locked alert');
    assert.ok(n.json.unread >= 1);
  });

  await t.test('hysteresis: stays locked until actually emptied', async () => {
    let r = await http('POST', '/device/telemetry', { device: deviceKey, body: { compartments: [{ stream: 'organic', fill_pct: 85 }] } });
    assert.equal(r.json.lock.organic, true, 'still locked at 85%');
    r = await http('POST', '/device/telemetry', { device: deviceKey, body: { compartments: [{ stream: 'organic', fill_pct: 95 }] } });
    assert.equal(r.json.lock.organic, true);
  });

  await t.test('collector starts and completes pickup', async () => {
    const pk = (await http('GET', '/pickups', { token: collector.token })).json.pickups.find((p) => p.stationId === station.id);
    const s = await http('POST', `/pickups/${pk.id}/start`, { token: collector.token, body: { etaMinutes: 30 } });
    assert.equal(s.status, 200, JSON.stringify(s.json));
    assert.equal(s.json.pickup.status, 'en_route');
    const c = await http('POST', `/pickups/${pk.id}/complete`, { token: collector.token, body: { weightKg: 18.5 } });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.equal(c.json.pickup.status, 'completed');
    const st = await http('GET', `/stations/${station.id}`, { token: resident.token });
    assert.equal(st.json.station.compartments.find((x) => x.stream === 'organic').locked, false);
    // Device gets the unlock on its next check-in
    const r = await http('POST', '/device/telemetry', { device: deviceKey, body: { compartments: [{ stream: 'organic', fill_pct: 4 }] } });
    assert.equal(r.json.lock.organic, false);
  });

  await t.test('recyclables flow into the recycler marketplace', async () => {
    let r = await http('POST', '/device/telemetry', { device: deviceKey, body: { compartments: [{ stream: 'recyclable', fill_pct: 93 }] } });
    assert.equal(r.json.lock.recyclable, true);
    const pk = (await http('GET', '/pickups', { token: collector.token })).json.pickups.find((p) => p.stationId === station.id && p.stream === 'recyclable');
    await http('POST', `/pickups/${pk.id}/complete`, { token: collector.token, body: { weightKg: 12, material: 'pet' } });
    const m = await http('GET', '/batches?group=plastics', { token: recycler.token });
    const pet = m.json.materials.find((x) => x.material === 'pet');
    assert.ok(pet && pet.weightKg >= 12);
    const res = await http('POST', '/batches/reserve-material', { token: recycler.token, body: { material: 'pet' } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const again = await http('POST', '/batches/reserve-material', { token: recycler.token, body: { material: 'pet' } });
    assert.equal(again.status, 409);
    const mine = await http('GET', '/batches/mine', { token: recycler.token });
    assert.ok(mine.json.weekKg >= 12);
  });

  await t.test('drops are refused on a locked compartment', async () => {
    await http('POST', '/device/telemetry', { device: deviceKey, body: { compartments: [{ stream: 'organic', fill_pct: 97 }] } });
    const d = await http('POST', '/me/drops', { token: resident.token, body: { stationId: station.id, stream: 'organic' } });
    assert.equal(d.status, 400);
  });

  await t.test('resident drop on open compartment', async () => {
    const d = await http('POST', '/me/drops', { token: resident.token, body: { stationId: station.id, stream: 'general' } });
    assert.equal(d.status, 201, JSON.stringify(d.json));
    assert.equal(d.json.amount, 2);
    const rep = await http('POST', '/reports', { token: resident.token, body: { stationId: station.id, category: 'odour', description: 'Smells bad near the organic side' } });
    assert.equal(rep.status, 201);
    const ov = await http('GET', '/admin/overview', { token: admin.token });
    assert.equal(ov.status, 200);
    assert.ok(ov.json.stationsOnline >= 1);
    const csv = await fetch(API + '/admin/export/pickups.csv', { headers: { Authorization: `Bearer ${admin.token}` } });
    assert.equal(csv.status, 200);
    assert.match(await csv.text(), /station_code/);
  });

  await t.test('key rotation revokes old key', async () => {
    const r = await http('POST', `/stations/${station.id}/device-key`, { token: admin.token });
    assert.equal(r.status, 200);
    assert.equal((await http('GET', '/device/config', { device: deviceKey })).status, 401);
    assert.equal((await http('GET', '/device/config', { device: r.json.deviceKey })).status, 200);
  });

  await t.test('deactivated user is locked out immediately', async () => {
    const u = await http('PATCH', `/admin/users/${collector.user.id}`, { token: admin.token, body: { isActive: false } });
    assert.equal(u.status, 200);
    assert.equal((await http('GET', '/pickups', { token: collector.token })).status, 401);
  });
});
