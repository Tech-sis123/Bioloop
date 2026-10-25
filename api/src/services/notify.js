// In-app notifications. Each helper fans one message out to a group of users
// with a single INSERT ... SELECT, inside whatever transaction it is given.

function insertFor(whereSql) {
  return async (db, params, { stationId = null, category, kind, title, body = '' }) => {
    await db.query(
      `INSERT INTO notifications(user_id, station_id, category, kind, title, body)
       SELECT u.id, $1, $2, $3, $4, $5 FROM users u WHERE u.is_active AND ${whereSql}`,
      [stationId, category, kind, title, body, ...params]
    );
  };
}

const residents = insertFor('u.role = \'resident\' AND u.home_station_id = $6');
const org = insertFor('u.org_id = $6');
const staff = insertFor('u.role IN (\'agency\',\'admin\')');
const user = insertFor('u.id = $6');

export const notifyResidents = (db, stationId, msg) => residents(db, [stationId], { stationId, ...msg });
export const notifyOrg = (db, orgId, msg) => (orgId ? org(db, [orgId], msg) : Promise.resolve());
export const notifyStaff = (db, msg) => staff(db, [], msg);
export const notifyUser = (db, userId, msg) => user(db, [userId], msg);
