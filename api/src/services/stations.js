import { config } from '../config.js';
import { many } from '../db.js';

export function isOnline(s) {
  if (!s.last_seen_at) return false;
  const limitMs = s.report_interval_s * 1000 * config.offlineAfterMultiplier;
  return Date.now() - new Date(s.last_seen_at).getTime() < limitMs;
}

export const STATION_SELECT = `
  SELECT s.*, o.name AS collector_org_name, o.phone AS collector_phone,
         d.key_prefix AS device_key_prefix, d.last_used_at AS device_last_used_at
  FROM stations s
  LEFT JOIN organizations o ON o.id = s.collector_org_id
  LEFT JOIN devices d ON d.station_id = s.id AND d.revoked_at IS NULL`;

export function compartmentRow(c) {
  return {
    stream: c.stream,
    fillPct: c.fill_pct,
    locked: c.locked,
    lockReason: c.lock_reason,
    deviceLocked: c.device_locked,
    lockedAt: c.locked_at,
    updatedAt: c.updated_at,
    lockThreshold: c.lock_threshold,
    unlockThreshold: c.unlock_threshold,
    nearFullThreshold: c.near_full_threshold,
    emptyDistanceCm: c.empty_distance_cm,
    fullDistanceCm: c.full_distance_cm,
  };
}

const ORDER = { general: 0, recyclable: 1, organic: 2 };

// Attach compartments (and optionally open pickups) to a list of station rows.
export async function hydrateStations(rows, { staff = false } = {}) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const comps = await many('SELECT * FROM compartments WHERE station_id = ANY($1::uuid[])', [ids]);
  const pickups = await many(
    `SELECT p.id, p.station_id, p.stream, p.status, p.eta, p.requested_at, o.name AS org_name
     FROM pickups p LEFT JOIN organizations o ON o.id = p.collector_org_id
     WHERE p.station_id = ANY($1::uuid[]) AND p.status IN ('pending','assigned','en_route')`,
    [ids]
  );
  return rows.map((s) => {
    const cs = comps.filter((c) => c.station_id === s.id).sort((a, b) => ORDER[a.stream] - ORDER[b.stream]);
    const out = {
      id: s.id,
      code: s.code,
      name: s.name,
      area: s.area,
      zone: s.zone,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      status: s.status,
      online: isOnline(s),
      lastSeenAt: s.last_seen_at,
      batteryPct: s.battery_pct,
      solarV: s.solar_v,
      rssi: s.rssi,
      tempC: s.temp_c,
      firmware: s.firmware,
      reportIntervalS: s.report_interval_s,
      collectorOrgId: s.collector_org_id,
      collectorOrgName: s.collector_org_name,
      collectorPhone: s.collector_phone,
      compartments: cs.map(compartmentRow),
      openPickups: pickups
        .filter((p) => p.station_id === s.id)
        .map((p) => ({ id: p.id, stream: p.stream, status: p.status, eta: p.eta, requestedAt: p.requested_at, orgName: p.org_name })),
      maxFill: cs.reduce((m, c) => Math.max(m, c.fill_pct), 0),
      anyLocked: cs.some((c) => c.locked),
    };
    if (staff) {
      out.deviceKeyPrefix = s.device_key_prefix;
      out.deviceLastUsedAt = s.device_last_used_at;
      out.createdAt = s.created_at;
    }
    return out;
  });
}
