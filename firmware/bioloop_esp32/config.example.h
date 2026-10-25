// Copy this file to config.h and fill it in. Do NOT commit config.h (it holds the device key).
#pragma once

#define FIRMWARE_VERSION "1.0.0"

// Wi-Fi
#define WIFI_SSID "your-wifi"
#define WIFI_PASS "your-password"

// From the BioLoop dashboard: Stations > (station) > Device > Issue new device key
#define API_URL    "https://bioloop-api.onrender.com"   // no trailing slash
#define DEVICE_KEY "blk_xxxxxxxx_paste-the-full-key-here"

// Pins (ESP32 Dev Module). Echo pins of 5 V sensors need a divider to 3.3 V.
#define PIN_TRIG_GENERAL     5
#define PIN_ECHO_GENERAL     18
#define PIN_TRIG_RECYCLABLE  19
#define PIN_ECHO_RECYCLABLE  21
#define PIN_TRIG_ORGANIC     22
#define PIN_ECHO_ORGANIC     23
#define PIN_LOCK_GENERAL     25
#define PIN_LOCK_RECYCLABLE  26
#define PIN_LOCK_ORGANIC     27
#define PIN_BATTERY          34   // ADC1 pin (works while Wi-Fi is on)

// Servo lock angles
#define SERVO_OPEN_DEG    0
#define SERVO_LOCKED_DEG  90

// Battery: voltage divider ratio and pack limits (example: 1S Li-ion with 2:1 divider)
#define BATTERY_DIVIDER  2.0
#define BATTERY_EMPTY_V  3.3
#define BATTERY_FULL_V   4.15

// Root certificate of the API host, PEM format. Leave commented while testing.
// See docs/IOT_INTEGRATION.md, section "TLS certificate".
// #define ROOT_CA "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
