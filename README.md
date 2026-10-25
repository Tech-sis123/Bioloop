# BioLoop

Smart waste overflow management. Sensor-equipped 3-compartment bins report how full they are, lock before they overflow, and automatically request pickups. Residents, collectors, recyclers and the waste agency each get their own app.

```
api/        Node.js + Express + Postgres API (deploy on Render)
web/        React (Vite) web app for every role (deploy on Vercel)
firmware/   Reference ESP32 firmware for the station
docs/       IOT_INTEGRATION.md: everything the hardware engineer needs
render.yaml Render blueprint (API + database)
```

## Who uses what

| Role | How they get an account | What they see |
|---|---|---|
| Resident | Signs up in the app | Live fill of their bin, alerts, pickup ETA, sort guide, Loop points, report a problem |
| Collector | Invited by agency | Today's route sorted by urgency, start route with ETA, mark as emptied with weight |
| Recycler | Invited by agency | Sorted material batches, reserve, orders |
| Agency staff / Admin | Invited (admin) / created on first deploy | Dashboard: live map, KPIs, stations and device keys, calibration, pickups, companies, people, reports, CSV export, audit log |

## How the pieces connect

```
 ESP32 station ──HTTPS + device key──▶  Render: bioloop-api  ◀──▶ Render Postgres
                                           ▲
 Browser ──▶ Vercel (web app) ──/api/*─────┘   (Vercel proxies /api so login cookies stay first-party)
```

1. A sensor posts readings to `/api/v1/device/telemetry`.
2. At 75% the API requests a pickup from that station's collection company and alerts residents.
3. At 90% the compartment locks (the reply tells the device to lock the lid). Residents, collectors and the agency are alerted.
4. The collector marks it emptied (or the sensor sees it drop below 30%), the lid unlocks, and sorted recyclables become a batch recyclers can reserve.

## Security built in

- Passwords hashed with bcrypt (cost 12), strength rules, common-password block
- 15 minute access tokens kept in memory only; refresh token in an httpOnly, Secure, SameSite cookie, rotated on every use with reuse detection (a stolen, replayed token kills the whole session)
- CSRF protection on cookie endpoints, strict CORS allowlist, Helmet security headers, CSP on the web app
- Account lockout after 5 failed logins (15 min), rate limits on login, API and per device
- Same error and timing for unknown email vs wrong password (no account discovery)
- Public sign-up can only create residents; roles are assigned by staff; agency staff cannot create admins
- Role and company checks on every endpoint (a collector only sees their company's pickups)
- Deactivating a user or changing their role ends their sessions immediately
- Device keys are random, stored as SHA-256 hashes, shown once, and can be rotated
- All input validated with zod; parameterised SQL only; 32 KB body limit
- Audit log of sign-ins, role changes, key rotations, exports
- CSV export protected against spreadsheet formula injection
- No secrets in logs (auth headers and cookies are redacted)

## Deploy

You need a GitHub repo with this code, a Render account and a Vercel account.

### 1. API + database on Render

1. Render dashboard > **New > Blueprint** > pick this repo. It reads `render.yaml` and creates `bioloop-api` and `bioloop-db`.
2. Fill in the prompted values:
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`: your first admin login (password: 8+ characters with a letter and a number)
   - `CORS_ORIGINS` and `APP_URL`: your Vercel URL, e.g. `https://bioloop.vercel.app` (you can set these after step 2 and redeploy)
   - `RESEND_API_KEY`: optional, for password reset emails
3. Deploy. Check `https://<your-api>.onrender.com/health` returns `{"ok":true,"db":"up"}`.
4. Note the exact API URL Render gives you. If it is not `https://bioloop-api.onrender.com`, update it in `web/vercel.json` (the `/api/:path*` rewrite).
5. After your first login works, delete `ADMIN_PASSWORD` from Render's environment.

> Render free plans sleep after inactivity and free Postgres databases expire. For real users, move the web service to **Starter** and the database to a paid plan (or point `DATABASE_URL` at Neon/Supabase with `DATABASE_SSL=true`).

### 2. Web app on Vercel

1. Vercel > **Add New > Project** > import the repo.
2. Set **Root Directory** to `web`. Framework is detected as Vite.
3. Environment variable: `VITE_DEVICE_API_URL` = your Render API URL (shown next to new device keys).
4. Deploy. Put the Vercel URL into Render's `CORS_ORIGINS` and `APP_URL` if you have not yet.

### 3. First run

1. Sign in with the admin account. You land on the agency dashboard.
2. **Collectors** > add your collection companies. **Recyclers** > add recyclers.
3. **Stations** > Add station (code, name, location, company). Copy the device key it shows and give it, with the API URL, to the IoT engineer along with `docs/IOT_INTEGRATION.md`.
4. **People** > invite collectors and recyclers. Each gets a one-time link to set their password (emailed if Resend is set up, otherwise copy it to WhatsApp/SMS).
5. Residents sign up themselves and enter their bin code (printed on the station).

## Run locally

```bash
# Postgres running locally, then:
cd api && cp .env.example .env && npm install && node --env-file=.env src/index.js
cd web && npm install && npm run dev      # http://localhost:5173 (proxies /api to :4000)

# Pretend to be a sensor
cd api && node tools/simulate-device.mjs --key <device key> --interval 5

# End-to-end tests (API must be running)
cd api && npm test
```

## API overview

All under `/api/v1`. Users send `Authorization: Bearer <access token>`; devices send their device key.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` `/auth/login` `/auth/refresh` `/auth/logout` `/auth/logout-all` `/auth/change-password` `/auth/forgot-password` `/auth/reset-password`, `GET /auth/me` |
| Devices | `GET /device/config`, `POST /device/telemetry` |
| Stations | `GET /stations`, `GET /stations/:id`, `GET /stations/:id/readings`, `POST /stations`, `PATCH /stations/:id`, `PATCH /stations/:id/compartments/:stream`, `POST /stations/:id/device-key` |
| Pickups | `GET /pickups`, `GET /pickups/summary`, `POST /pickups`, `POST /pickups/start-route`, `POST /pickups/:id/start` `/assign` `/complete` `/cancel` |
| Residents | `PATCH /me`, `GET /me/activity`, `POST /me/drops` |
| Alerts | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`, `POST /notifications/:id/read` |
| Reports | `POST /reports`, `GET /reports`, `GET /reports/mine`, `POST /reports/:id/resolve` |
| Recycling | `GET /batches`, `GET /batches/mine`, `POST /batches`, `POST /batches/reserve-material`, `POST /batches/:id/reserve` `/collected` `/release` |
| Admin | `GET /admin/overview`, `GET /admin/export/pickups.csv`, orgs, users, `GET /admin/audit` |
