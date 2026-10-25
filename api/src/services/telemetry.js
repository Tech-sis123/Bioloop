import { config } from '../config.js';
import { ensurePickup } from './pickups.js';
import { notifyOrg, notifyResidents, notifyStaff } from './notify.js';
import { streamLabel } from './labels.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Convert an ultrasonic/ToF distance reading into a fill percentage using the
// compartment's calibration. empty = sensor-to-bottom, full = sensor-to-100%.
export function distanceToFill(distanceCm, emptyCm, fullCm) {
  if (emptyCm <= fullCm) return 0;
  return Math.round(clamp(((emptyCm - distanceCm) / (emptyCm - fullCm)) * 100, 0, 100));
}

// Decide whether a compartment should be locked after this reading.
// Hysteresis: lock at lock_threshold, only unlock once it drops to unlock_threshold
// (i.e. it has actually been emptied), so the lid does not flap at the edge.
export function decideLock(comp, fill) {
  if (comp.lock_reason === 'manual') return { locked: true, reason: 'manual' };
  if (fill >= comp.lock_threshold) return { locked: true, reason: 'full' };
  if (comp.locked && comp.lock_reason === 'full' && fill > comp.unlock_threshold) return { locked: true, reason: 'full' };
  return { locked: false, reason: null };
}

const DEVICE_EVENTS = {
  tamper: { title: 'Tamper detected', category: 'damaged' },
  lid_jam: { title: 'Lid jammed', category: 'damaged' },
  sensor_fault: { title: 'Sensor fault', category: 'sensor' },
  high_temp: { title: 'High temperature inside bin', category: 'other' },
  lock_fault: { title: 'Lock mechanism fault', category: 'damaged' },
};

/**
 * Apply one telemetry message from a station. Runs inside a transaction.
 * Returns the command payload sent back to the device.
 */
export async function applyTelemetry(db, station, payload) {
  const now = new Date();
  const prevBattery = station.battery_pct;

  await db.query(
    `UPDATE stations SET last_seen_at = now(), offline_alerted = false,
       battery_pct = COALESCE($2, battery_pct), solar_v = COALESCE($3, solar_v), rssi = COALESCE($4, rssi),
       temp_c = COALESCE($5, temp_c), firmware = COALESCE($6, firmware)
     WHERE id = $1`,
    [station.id, payload.battery ?? null, payload.solar_v ?? null, payload.rssi ?? null, payload.temp_c ?? null, payload.fw ?? null]
  );

  // Station came back after being reported offline
  if (station.offline_alerted) {
    await notifyStaff(db, {
      stationId: station.id, category: 'bin', kind: 'station_online',
      title: `${station.code} is back online`, body: station.name,
    });
  }

  // Battery dropped below threshold on this reading
  if (payload.battery != null && payload.battery < config.lowBatteryPct && (prevBattery == null || prevBattery >= config.lowBatteryPct)) {
    await notifyStaff(db, {
      stationId: station.id, category: 'bin', kind: 'battery_low',
      title: `${station.code} battery low (${payload.battery}%)`,
      body: 'Check the solar panel and battery.',
    });
  }

  const results = [];
  for (const c of payload.compartments) {
    let comp = await db.one('SELECT * FROM compartments WHERE station_id = $1 AND stream = $2 FOR UPDATE', [station.id, c.stream]);
    if (!comp) {
      comp = await db.one('INSERT INTO compartments(station_id, stream) VALUES ($1,$2) RETURNING *', [station.id, c.stream]);
    }

    const fill = c.fill_pct != null
      ? Math.round(clamp(c.fill_pct, 0, 100))
      : distanceToFill(c.distance_cm, comp.empty_distance_cm, comp.full_distance_cm);

    await db.query('INSERT INTO readings(station_id, stream, fill_pct, distance_cm, recorded_at) VALUES ($1,$2,$3,$4,$5)',
      [station.id, c.stream, fill, c.distance_cm ?? null, now]);

    const { locked, reason } = decideLock(comp, fill);
    const wasLocked = comp.locked;
    const prevFill = comp.fill_pct;

    await db.query(
      `UPDATE compartments SET fill_pct = $3, locked = $4, lock_reason = $5, device_locked = COALESCE($6, device_locked),
         locked_at = CASE WHEN $4 AND NOT locked THEN now() WHEN NOT $4 THEN NULL ELSE locked_at END,
         updated_at = now()
       WHERE station_id = $1 AND stream = $2`,
      [station.id, c.stream, fill, locked, reason, c.lid_locked ?? null]
    );

    const label = streamLabel(c.stream);

    // Newly locked because full
    if (locked && !wasLocked && reason === 'full') {
      const { pickup } = await ensurePickup(db, station, c.stream, { fill });
      await notifyResidents(db, station.id, {
        category: 'bin', kind: 'locked',
        title: `${label} compartment locked`,
        body: `${station.code} hit ${fill}%. Use another compartment until pickup.`,
      });
      await notifyStaff(db, {
        stationId: station.id, category: 'bin', kind: 'locked',
        title: `${station.code} ${label.toLowerCase()} locked at ${fill}%`, body: station.name,
      });
      if (pickup?.collector_org_id) {
        await notifyOrg(db, pickup.collector_org_id, {
          stationId: station.id, category: 'bin', kind: 'locked',
          title: `${station.code} is locked and waiting`, body: `${label} at ${fill}%. ${station.name}.`,
        });
      }
    } else if (!locked && fill >= comp.near_full_threshold && prevFill < comp.near_full_threshold) {
      // Crossed the near-full line: request collection before it overflows
      await ensurePickup(db, station, c.stream, { fill });
      await notifyResidents(db, station.id, {
        category: 'bin', kind: 'near_full',
        title: `${label} at ${fill}%`, body: `${station.code} is filling up. Pickup requested.`,
      });
    }

    // Emptied: was locked (or near full) and is now low
    if (wasLocked && !locked && comp.lock_reason === 'full') {
      await db.query(
        `UPDATE pickups SET status = 'completed', completed_at = now(),
           notes = COALESCE(notes || ' ', '') || '(Confirmed by sensor)'
         WHERE station_id = $1 AND stream = $2 AND status IN ('pending','assigned','en_route')`,
        [station.id, c.stream]
      );
      await notifyResidents(db, station.id, {
        category: 'pickup', kind: 'emptied',
        title: `${label} emptied`, body: `${station.code} lid unlocked. Thanks for sorting.`,
      });
    }

    results.push({ stream: c.stream, fill_pct: fill, lock: locked });
  }

  // Device-reported events (tamper, lid jam...) become problem reports for staff
  for (const ev of payload.events || []) {
    const def = DEVICE_EVENTS[ev];
    if (!def) continue;
    const recent = await db.one(
      `SELECT 1 FROM problem_reports WHERE station_id = $1 AND user_id IS NULL AND description = $2
         AND status = 'open' AND created_at > now() - interval '6 hours'`,
      [station.id, `[device] ${def.title}`]
    );
    if (recent) continue; // do not spam
    await db.query(`INSERT INTO problem_reports(station_id, category, description) VALUES ($1,$2,$3)`,
      [station.id, def.category, `[device] ${def.title}`]);
    await notifyStaff(db, {
      stationId: station.id, category: 'bin', kind: 'device_event',
      title: `${station.code}: ${def.title}`, body: station.name,
    });
  }

  // Desired lock state for every compartment (including ones not in this message)
  const all = await db.many('SELECT stream, locked, lock_threshold, unlock_threshold FROM compartments WHERE station_id = $1 ORDER BY stream', [station.id]);
  const lock = {};
  for (const r of all) lock[r.stream] = r.locked;

  return {
    ok: true,
    station: station.code,
    server_time: now.toISOString(),
    lock,
    compartments: results,
    next_report_s: station.report_interval_s,
    thresholds: Object.fromEntries(all.map((r) => [r.stream, { lock: r.lock_threshold, unlock: r.unlock_threshold }])),
    maintenance: station.status === 'maintenance',
  };
}
