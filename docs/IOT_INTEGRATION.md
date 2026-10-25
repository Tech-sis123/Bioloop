# BioLoop: IoT Integration Guide

For the hardware / IoT engineer connecting a BioLoop station to the live system.

The backend is already deployed and running. Your device only has to do two things:

1. Every few minutes, send the fill level of each compartment to one HTTPS endpoint.
2. Read the reply and lock or unlock each lid the way the server says.

Everything else (alerts to residents, pickup requests to collectors, the agency dashboard, recycler marketplace) happens automatically on the server.

---

## 1. What you get from the BioLoop admin

For each physical station the admin creates it in the dashboard (Stations > Add station) and gives you:

| Item | Example |
|---|---|
| API URL | `https://bioloop-api.onrender.com` |
| Station code | `BL-049` |
| Device key | `blk_a39c02f1_Xq3...` (about 45 characters) |

The device key is shown only once. If it is lost or leaks, the admin clicks **Issue new device key** and the old one stops working immediately.

One key = one station. Never reuse a key on two stations.

---

## 2. Test before touching hardware (2 minutes)

From any laptop with Node.js 20+:

```bash
git clone <repo> && cd <repo>/api
node tools/simulate-device.mjs --url https://bioloop-api.onrender.com --key blk_xxxxxxxx_yyyy --interval 5
```

You will see the simulated bins fill up, lock at 90%, and unlock when "emptied". Open the dashboard at the same time and watch the station change live. If this works, the server side is confirmed and any later problem is on the device.

Quick one-off test with curl:

```bash
curl -X POST https://bioloop-api.onrender.com/api/v1/device/telemetry \
  -H "Authorization: Bearer blk_xxxxxxxx_yyyy" \
  -H "Content-Type: application/json" \
  -d '{"battery":86,"compartments":[{"stream":"general","fill_pct":42},{"stream":"recyclable","fill_pct":68},{"stream":"organic","fill_pct":91}]}'
```

---

## 3. Authentication

Send the key on every request in one of these headers:

```
Authorization: Bearer blk_a39c02f1_Xq3...
```
or
```
X-Device-Key: blk_a39c02f1_Xq3...
```

HTTPS only. The key is a password: keep it out of logs, screenshots and Git (use `config.h`, which is git-ignored).

---

## 4. Endpoints

### `GET /api/v1/device/config`

Call once on boot. Confirms the key works and returns calibration, thresholds and the current lock state.

```json
{
  "ok": true,
  "station": "BL-049",
  "name": "Jaja Hall bin point",
  "server_time": "2026-10-25T07:30:00.000Z",
  "next_report_s": 300,
  "maintenance": false,
  "lock": { "general": false, "organic": true, "recyclable": false },
  "compartments": [
    { "stream": "general", "lock_threshold": 90, "unlock_threshold": 30, "near_full_threshold": 75,
      "empty_distance_cm": 60, "full_distance_cm": 8 }
  ]
}
```

### `POST /api/v1/device/telemetry`

Send every `next_report_s` seconds (default 300 = 5 minutes).

**Request body**

```json
{
  "fw": "1.0.0",
  "battery": 86,
  "solar_v": 5.2,
  "rssi": -67,
  "temp_c": 31.5,
  "compartments": [
    { "stream": "general",    "distance_cm": 38.2, "lid_locked": false },
    { "stream": "recyclable", "distance_cm": 24.6, "lid_locked": false },
    { "stream": "organic",    "distance_cm": 12.7, "lid_locked": true }
  ],
  "events": ["tamper"]
}
```

| Field | Required | Notes |
|---|---|---|
| `compartments` | yes | 1 to 3 items. You can send only the ones you measured. |
| `compartments[].stream` | yes | `general`, `recyclable` or `organic`. Also accepted: `yellow`, `blue`, `green`, `recyclables`, `food`. |
| `compartments[].distance_cm` | one of these two | Raw sensor distance. The server converts it to % using the station's calibration. **Preferred**, because calibration can then be changed from the dashboard without reflashing. |
| `compartments[].fill_pct` | one of these two | 0 to 100 if you prefer to compute it on the device. |
| `compartments[].lid_locked` | no | What the lock actually is right now. Shown in the dashboard. |
| `battery` | no | 0 to 100 (%). Below 20% the agency gets a "battery low" alert. |
| `solar_v`, `rssi`, `temp_c`, `fw` | no | Shown in the dashboard for maintenance. |
| `events` | no | Any of: `tamper`, `lid_jam`, `sensor_fault`, `lock_fault`, `high_temp`. Each opens a problem report for the agency (repeats within 6 hours are ignored). |
| `station` | no | If sent, must match the key's station code. Useful to catch mixed-up keys. |

**Response (200)**

```json
{
  "ok": true,
  "station": "BL-049",
  "server_time": "2026-10-25T07:35:00.000Z",
  "lock": { "general": false, "organic": true, "recyclable": false },
  "compartments": [
    { "stream": "general", "fill_pct": 42, "lock": false },
    { "stream": "recyclable", "fill_pct": 68, "lock": false },
    { "stream": "organic", "fill_pct": 91, "lock": true }
  ],
  "next_report_s": 300,
  "thresholds": { "organic": { "lock": 90, "unlock": 30 } },
  "maintenance": false
}
```

**What the device must do with the reply:** set each lid to `lock[stream]` (true = locked), and wait `next_report_s` seconds before the next report.

### Errors

| Status | Meaning | Device should |
|---|---|---|
| 400 | Payload invalid. Body has `error.message` and `error.fields`. | Log it. Fix firmware. |
| 401 | Key missing, wrong or revoked. | Stop and show an error LED. Needs a new key. |
| 403 | Station retired. | Stop reporting. |
| 429 | Too many requests (limit is 30 per minute per device). | Back off, retry later. |
| 5xx / timeout | Server or network problem. | Use the offline fallback below, retry next cycle. |

---

## 5. How locking works (important)

The server is the source of truth, with a local fallback.

- A compartment **locks** when fill reaches `lock_threshold` (default 90%).
- It stays locked until fill drops to `unlock_threshold` (default 30%), meaning it was actually emptied. This gap stops the lid flapping open and shut around 90%.
- When a collector taps **Mark as emptied** in their app, the server unlocks right away. The next reading confirms it. If the bin is still full, it re-locks.
- Agency staff can force a lid closed for maintenance from the dashboard. The device just sees `lock: true`.
- At `near_full_threshold` (default 75%) the server automatically requests a pickup from the station's collection company.

**Offline fallback:** if the server cannot be reached, lock locally using the last thresholds from `/config` (the sample firmware already does this). When the connection comes back, follow the server again.

---

## 6. Calibration (if you send `distance_cm`)

For each compartment, with the sensor mounted in its final position:

1. **Empty distance:** distance from the sensor to the bottom of the empty bin (e.g. 60 cm).
2. **Full distance:** distance from the sensor to the level where waste should stop when 100% full (e.g. 8 cm). Leave a few cm below the lid.

Enter both in the dashboard: Stations > (station) > **Calibrate**. Fill % = (empty - reading) / (empty - full) x 100.

Ultrasonic tips: take 5 readings and use the median (the sample firmware does). Use a waterproof JSN-SR04T for outdoor bins. Mount it pointing straight down, away from the walls, so the beam does not hit the sides.

---

## 7. Reference firmware (ESP32)

In `firmware/bioloop_esp32/`:

1. Copy `config.example.h` to `config.h` and fill in Wi-Fi, `API_URL`, `DEVICE_KEY` and pins.
2. Install libraries: **ArduinoJson** (v7) and **ESP32Servo**.
3. Flash with board "ESP32 Dev Module". Open Serial Monitor at 115200 to see each report and the HTTP status.

The sketch reads 3 ultrasonic sensors, reads battery voltage, posts telemetry, drives 3 servo locks from the reply, and falls back to local locking when offline. If you use solenoid locks or relays instead of servos, only change `setLock()`.

Default wiring (change in `config.h`):

| Function | General | Recyclable | Organic |
|---|---|---|---|
| Ultrasonic TRIG | GPIO 5 | GPIO 19 | GPIO 22 |
| Ultrasonic ECHO | GPIO 18 | GPIO 21 | GPIO 23 |
| Lock servo | GPIO 25 | GPIO 26 | GPIO 27 |
| Battery ADC | GPIO 34 (via 2:1 divider) | | |

5 V sensors: put a voltage divider on ECHO, the ESP32 is 3.3 V only.

---

## 8. TLS certificate

While testing, the sketch skips certificate checks (`setInsecure`) and prints a warning. **Before installing in the field, turn verification on:**

1. Get the root certificate of the API host:
   ```bash
   openssl s_client -showcerts -connect bioloop-api.onrender.com:443 </dev/null
   ```
   The last certificate in the chain is the root. Or open the API URL in a browser, view the certificate, and export the top (root) certificate as PEM.
2. Paste it into `config.h` as `ROOT_CA` (each line ending with `\n`).

Root certificates last for years, but if the host ever changes certificate authority, devices will start failing with a TLS error, so keep a way to update firmware (OTA is a good next step).

---

## 9. Connectivity notes

- **Wi-Fi (ESP32):** works out of the box.
- **Cellular:** use a 4G module that supports TLS 1.2, such as SIM7600 or A7670. The older **SIM800L (2G) does not reliably do modern HTTPS** and should be avoided.
- Data use: the report itself is about 400 bytes, but each new HTTPS connection adds a TLS handshake of roughly 5 KB. At one report every 5 minutes that is about 1.5 MB a day, around 50 MB a month per station. Plan SIM data bundles with that in mind.
- The API runs on Render. On the free plan it sleeps after 15 minutes without traffic and the first request can take up to a minute to wake it. Devices reporting every 5 minutes keep it awake. Use a 15 second timeout and just retry next cycle if one request fails.

---

## 10. Checklist before handing a station over

- [ ] `GET /config` returns 200 with the right station code
- [ ] Station shows **Online** in the dashboard within one report
- [ ] Fill % in the dashboard matches reality (adjust calibration if not)
- [ ] Filling a compartment past 90% locks the lid and residents get an alert
- [ ] Collector "Mark as emptied" unlocks the lid on the next report
- [ ] Pulling Wi-Fi: bin still locks locally when full
- [ ] Battery % looks right
- [ ] `ROOT_CA` set, insecure mode off
- [ ] `config.h` not committed to Git

Questions about the server side: contact the BioLoop software lead.
