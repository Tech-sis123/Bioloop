import { notifyOrg, notifyResidents, notifyStaff } from './notify.js';
import { streamLabel } from './labels.js';

// Make sure an open pickup exists for this compartment. Returns the pickup.
// Auto-assigns to the station's collection company when one is set.
export async function ensurePickup(db, station, stream, { fill, source = 'auto', createdBy = null, notes = null } = {}) {
  const existing = await db.one(
    `SELECT * FROM pickups WHERE station_id = $1 AND stream = $2 AND status IN ('pending','assigned','en_route')`,
    [station.id, stream]
  );
  if (existing) return { pickup: existing, created: false };

  const orgId = station.collector_org_id || null;
  const pickup = await db.one(
    `INSERT INTO pickups(station_id, stream, status, collector_org_id, source, fill_at_request, assigned_at, created_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [station.id, stream, orgId ? 'assigned' : 'pending', orgId, source, fill ?? null, orgId ? new Date() : null, createdBy, notes]
  );
  if (!pickup) {
    // Lost a race with a concurrent request; return the winner.
    const row = await db.one(
      `SELECT * FROM pickups WHERE station_id = $1 AND stream = $2 AND status IN ('pending','assigned','en_route')`,
      [station.id, stream]
    );
    return { pickup: row, created: false };
  }

  const label = streamLabel(stream);
  if (orgId) {
    const orgRow = await db.one('SELECT name FROM organizations WHERE id = $1', [orgId]);
    await notifyOrg(db, orgId, {
      stationId: station.id,
      category: 'pickup',
      kind: 'pickup_assigned',
      title: `New pickup: ${station.code}`,
      body: `${label} at ${station.name} is at ${fill ?? '?'}%.`,
    });
    await notifyResidents(db, station.id, {
      category: 'pickup',
      kind: 'pickup_assigned',
      title: `Pickup assigned to ${orgRow?.name || 'a collector'}`,
      body: `${label} compartment is scheduled for collection.`,
    });
  } else {
    await notifyStaff(db, {
      stationId: station.id,
      category: 'pickup',
      kind: 'pickup_unassigned',
      title: `${station.code} needs a collector`,
      body: `${label} is at ${fill ?? '?'}% and no collection company is assigned.`,
    });
  }
  return { pickup, created: true };
}

// Shared shape for API responses
export function pickupRow(p) {
  return {
    id: p.id,
    stationId: p.station_id,
    stationCode: p.station_code,
    stationName: p.station_name,
    stationArea: p.station_area,
    lat: p.lat,
    lng: p.lng,
    stream: p.stream,
    status: p.status,
    collectorOrgId: p.collector_org_id,
    collectorOrgName: p.collector_org_name,
    collectorPhone: p.collector_phone,
    collectorUserId: p.collector_user_id,
    source: p.source,
    fillAtRequest: p.fill_at_request,
    currentFill: p.current_fill,
    locked: p.locked,
    eta: p.eta,
    weightKg: p.weight_kg,
    material: p.material,
    notes: p.notes,
    requestedAt: p.requested_at,
    assignedAt: p.assigned_at,
    startedAt: p.started_at,
    completedAt: p.completed_at,
  };
}

export const PICKUP_SELECT = `
  SELECT p.*, s.code AS station_code, s.name AS station_name, s.area AS station_area, s.lat, s.lng,
         o.name AS collector_org_name, o.phone AS collector_phone,
         c.fill_pct AS current_fill, c.locked
  FROM pickups p
  JOIN stations s ON s.id = p.station_id
  LEFT JOIN organizations o ON o.id = p.collector_org_id
  LEFT JOIN compartments c ON c.station_id = p.station_id AND c.stream = p.stream`;
