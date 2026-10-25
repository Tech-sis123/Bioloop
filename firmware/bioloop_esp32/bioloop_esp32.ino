/*
  BioLoop station firmware (reference) for ESP32
  ------------------------------------------------
  - 3 ultrasonic sensors (JSN-SR04T or HC-SR04), one per compartment
  - 3 lid locks driven by servos (or swap in solenoid/relay code in setLock())
  - Battery voltage through a divider on an ADC pin
  - Reports to the BioLoop API over HTTPS and obeys the lock commands it returns
  - If the server cannot be reached, it locks locally at the last known threshold

  Libraries (Arduino Library Manager): ArduinoJson (v7), ESP32Servo
  Board: ESP32 Dev Module (Arduino-ESP32 core 2.x or 3.x)

  Fill in config.h before flashing. Full guide: docs/IOT_INTEGRATION.md
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include "config.h"

const char* STREAMS[3] = {"general", "recyclable", "organic"};
const int TRIG[3] = {PIN_TRIG_GENERAL, PIN_TRIG_RECYCLABLE, PIN_TRIG_ORGANIC};
const int ECHO[3] = {PIN_ECHO_GENERAL, PIN_ECHO_RECYCLABLE, PIN_ECHO_ORGANIC};
const int LOCKPIN[3] = {PIN_LOCK_GENERAL, PIN_LOCK_RECYCLABLE, PIN_LOCK_ORGANIC};

Servo locks[3];
bool locked[3] = {false, false, false};

// Values the server sends back. Defaults are used until the first /config call works.
uint32_t reportIntervalS = 300;
float emptyCm[3] = {60, 60, 60};
float fullCm[3] = {8, 8, 8};
int lockAt[3] = {90, 90, 90};
int unlockBelow[3] = {30, 30, 30};

WiFiClientSecure tls;

// ---------- Hardware ----------

float readDistanceOnce(int i) {
  digitalWrite(TRIG[i], LOW);
  delayMicroseconds(4);
  digitalWrite(TRIG[i], HIGH);
  delayMicroseconds(12);
  digitalWrite(TRIG[i], LOW);
  unsigned long us = pulseIn(ECHO[i], HIGH, 30000UL);  // 30 ms timeout (~5 m)
  if (us == 0) return -1;
  return us / 58.0;  // cm
}

// Median of 5 readings, ignores failed pings. Returns -1 if the sensor is dead.
float readDistance(int i) {
  float v[5];
  int n = 0;
  for (int k = 0; k < 5; k++) {
    float d = readDistanceOnce(i);
    if (d > 0) v[n++] = d;
    delay(60);
  }
  if (n == 0) return -1;
  for (int a = 0; a < n; a++)
    for (int b = a + 1; b < n; b++)
      if (v[b] < v[a]) { float t = v[a]; v[a] = v[b]; v[b] = t; }
  return v[n / 2];
}

int distanceToFill(int i, float d) {
  float pct = (emptyCm[i] - d) / (emptyCm[i] - fullCm[i]) * 100.0;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return (int)round(pct);
}

int batteryPercent() {
  // Divider halves the battery voltage. Tune BATTERY_EMPTY_V / BATTERY_FULL_V for your pack.
  float v = analogReadMilliVolts(PIN_BATTERY) / 1000.0 * BATTERY_DIVIDER;
  float pct = (v - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V) * 100.0;
  return constrain((int)pct, 0, 100);
}

void setLock(int i, bool on) {
  if (locked[i] == on) return;
  locks[i].write(on ? SERVO_LOCKED_DEG : SERVO_OPEN_DEG);
  locked[i] = on;
  Serial.printf("[lock] %s -> %s\n", STREAMS[i], on ? "LOCKED" : "open");
}

// ---------- Network ----------

bool ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int t = 0; t < 40 && WiFi.status() != WL_CONNECTED; t++) delay(250);
  Serial.printf("[wifi] %s\n", WiFi.status() == WL_CONNECTED ? "connected" : "failed");
  return WiFi.status() == WL_CONNECTED;
}

// Returns HTTP status, fills `response`. -1 on network error.
int apiCall(const char* method, const String& path, const String& body, String& response) {
  HTTPClient http;
  String url = String(API_URL) + path;
  if (!http.begin(tls, url)) return -1;
  http.setTimeout(15000);
  http.addHeader("Authorization", String("Bearer ") + DEVICE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "BioLoop-ESP32/" FIRMWARE_VERSION);
  int code = strcmp(method, "POST") == 0 ? http.POST(body) : http.GET();
  response = code > 0 ? http.getString() : "";
  http.end();
  return code;
}

void applyServerLocks(JsonDocument& doc) {
  JsonObject lock = doc["lock"];
  for (int i = 0; i < 3; i++) {
    if (lock[STREAMS[i]].is<bool>()) setLock(i, lock[STREAMS[i]].as<bool>());
  }
  if (doc["next_report_s"].is<uint32_t>()) reportIntervalS = max<uint32_t>(30, doc["next_report_s"].as<uint32_t>());
}

void fetchConfig() {
  String res;
  int code = apiCall("GET", "/api/v1/device/config", "", res);
  Serial.printf("[config] HTTP %d\n", code);
  if (code != 200) return;
  JsonDocument doc;
  if (deserializeJson(doc, res)) return;
  for (JsonObject c : doc["compartments"].as<JsonArray>()) {
    for (int i = 0; i < 3; i++) {
      if (strcmp(c["stream"] | "", STREAMS[i]) == 0) {
        emptyCm[i] = c["empty_distance_cm"] | emptyCm[i];
        fullCm[i] = c["full_distance_cm"] | fullCm[i];
        lockAt[i] = c["lock_threshold"] | lockAt[i];
        unlockBelow[i] = c["unlock_threshold"] | unlockBelow[i];
      }
    }
  }
  applyServerLocks(doc);
}

void reportOnce() {
  float dist[3];
  JsonDocument body;
  body["fw"] = FIRMWARE_VERSION;
  body["battery"] = batteryPercent();
  body["rssi"] = WiFi.RSSI();
  JsonArray comps = body["compartments"].to<JsonArray>();
  JsonArray events = body["events"].to<JsonArray>();
  for (int i = 0; i < 3; i++) {
    dist[i] = readDistance(i);
    if (dist[i] < 0) {
      events.add("sensor_fault");
      continue;
    }
    JsonObject c = comps.add<JsonObject>();
    c["stream"] = STREAMS[i];
    c["distance_cm"] = round(dist[i] * 10) / 10.0;  // server converts to % with its calibration
    c["lid_locked"] = locked[i];
  }
  if (comps.size() == 0) return;  // nothing valid to send

  String payload, res;
  serializeJson(body, payload);
  int code = ensureWifi() ? apiCall("POST", "/api/v1/device/telemetry", payload, res) : -1;
  Serial.printf("[telemetry] HTTP %d %s\n", code, res.c_str());

  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, res)) applyServerLocks(doc);
    return;
  }
  if (code == 401) Serial.println("[telemetry] Device key rejected. Ask the admin for a new key.");

  // Offline fallback: lock on our own so the bin still cannot overflow
  for (int i = 0; i < 3; i++) {
    if (dist[i] < 0) continue;
    int fill = distanceToFill(i, dist[i]);
    if (fill >= lockAt[i]) setLock(i, true);
    else if (locked[i] && fill <= unlockBelow[i]) setLock(i, false);
  }
}

// ---------- Arduino ----------

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nBioLoop station " FIRMWARE_VERSION);
  for (int i = 0; i < 3; i++) {
    pinMode(TRIG[i], OUTPUT);
    pinMode(ECHO[i], INPUT);
    locks[i].attach(LOCKPIN[i]);
    locks[i].write(SERVO_OPEN_DEG);
  }
  analogReadResolution(12);

#ifdef ROOT_CA
  tls.setCACert(ROOT_CA);   // production: verify the server certificate
#else
  tls.setInsecure();        // TESTING ONLY. Add ROOT_CA in config.h before deploying.
  Serial.println("[tls] WARNING: certificate not verified (no ROOT_CA set)");
#endif

  if (ensureWifi()) fetchConfig();
}

unsigned long lastReport = 0;

void loop() {
  if (lastReport == 0 || millis() - lastReport >= reportIntervalS * 1000UL) {
    lastReport = millis();
    reportOnce();
  }
  delay(200);
}
