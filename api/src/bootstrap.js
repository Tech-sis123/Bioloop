import { config } from './config.js';
import { logger } from './logger.js';
import { one, tx } from './db.js';
import { hashPassword } from './lib/auth.js';
import { password as passwordRule, email as emailRule } from './lib/validate.js';

// Create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD if no admin exists.
export async function ensureAdmin() {
  const existing = await one(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (existing) return;
  if (!config.adminEmail || !config.adminPassword) {
    logger.warn('No admin account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create one.');
    return;
  }
  const email = emailRule.parse(config.adminEmail);
  const check = passwordRule.safeParse(config.adminPassword);
  if (!check.success) {
    logger.error(`ADMIN_PASSWORD is too weak: ${check.error.issues[0].message}`);
    return;
  }
  const taken = await one('SELECT id FROM users WHERE email = $1', [email]);
  if (taken) {
    await one(`UPDATE users SET role = 'admin', org_id = NULL WHERE id = $1 RETURNING id`, [taken.id]);
    logger.info({ email }, 'Existing user promoted to admin');
    return;
  }
  await one(
    `INSERT INTO users(email, full_name, password_hash, role) VALUES ($1,$2,$3,'admin') RETURNING id`,
    [email, config.adminName, await hashPassword(config.adminPassword)]
  );
  logger.info({ email }, 'Admin account created. You can now remove ADMIN_PASSWORD from the environment.');
}

// Optional starter data (organisations + 4 Lagos stations). No user accounts or device keys.
export async function seedDemo() {
  if (!config.seedDemo) return;
  const any = await one('SELECT 1 FROM stations LIMIT 1');
  if (any) return;
  await tx(async (db) => {
    const org = async (name, kind, phone, area) =>
      (await db.one('INSERT INTO organizations(name, kind, phone, area) VALUES ($1,$2,$3,$4) RETURNING id', [name, kind, phone, area])).id;
    await org('Lagos Mainland Waste Office', 'agency', null, 'Lagos Mainland');
    const cleanroute = await org('CleanRoute NG', 'collector', '+2348043836391', 'Akoka, Yaba');
    const ecohaul = await org('EcoHaul Lagos', 'collector', null, 'Yaba, Surulere');
    await org('GreenCycle Yaba', 'recycler', null, 'Yaba');

    const stations = [
      ['BL-049', 'Jaja Hall bin point', 'UNILAG, Akoka', 6.5158, 3.3966, cleanroute],
      ['BL-112', 'Sabo Market', 'Yaba', 6.5095, 3.3711, cleanroute],
      ['BL-087', 'Herbert Macaulay Way', 'Yaba', 6.4985, 3.3785, ecohaul],
      ['BL-203', 'Ojuelegba Park', 'Surulere', 6.5085, 3.3630, null],
    ];
    for (const [code, name, area, lat, lng, orgId] of stations) {
      const s = await db.one(
        `INSERT INTO stations(code, name, area, zone, lat, lng, collector_org_id) VALUES ($1,$2,$3,'Lagos Mainland',$4,$5,$6) RETURNING id`,
        [code, name, area, lat, lng, orgId]
      );
      for (const st of ['general', 'recyclable', 'organic']) {
        await db.query('INSERT INTO compartments(station_id, stream) VALUES ($1,$2)', [s.id, st]);
      }
    }
  });
  logger.info('Demo organisations and stations created');
}
