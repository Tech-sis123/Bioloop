-- BioLoop initial schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Organisations: waste agencies, collection companies, recyclers
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('agency','collector','recycler')),
  phone         text,
  area          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,                 -- e.g. BL-049
  name               text NOT NULL,                        -- e.g. Jaja Hall bin point
  area               text NOT NULL DEFAULT '',             -- e.g. UNILAG, Akoka
  zone               text NOT NULL DEFAULT 'Lagos',
  address            text NOT NULL DEFAULT '',
  lat                double precision,
  lng                double precision,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','retired')),
  collector_org_id   uuid REFERENCES organizations(id) ON DELETE SET NULL,
  battery_pct        smallint,
  solar_v            real,
  rssi               smallint,
  temp_c             real,
  firmware           text,
  report_interval_s  integer NOT NULL DEFAULT 300,
  last_seen_at       timestamptz,
  offline_alerted    boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL UNIQUE,
  phone               text,
  full_name           text NOT NULL,
  password_hash       text NOT NULL,
  role                text NOT NULL CHECK (role IN ('resident','collector','recycler','agency','admin')),
  org_id              uuid REFERENCES organizations(id) ON DELETE SET NULL,
  home_station_id     uuid REFERENCES stations(id) ON DELETE SET NULL,
  points              integer NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  failed_logins       integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  token_version       integer NOT NULL DEFAULT 0,          -- bump to kill all sessions
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_org_idx ON users(org_id);
CREATE INDEX users_home_station_idx ON users(home_station_id);

CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  replaced_by  uuid,
  user_agent   text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens(family_id);

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One active credential per station. Only a SHA-256 hash of the key is stored.
CREATE TABLE devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id   uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  key_prefix   text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  revoked_at   timestamptz,
  last_ip      text,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX devices_one_active_per_station ON devices(station_id) WHERE revoked_at IS NULL;

CREATE TABLE compartments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id         uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  stream             text NOT NULL CHECK (stream IN ('general','recyclable','organic')),
  fill_pct           smallint NOT NULL DEFAULT 0 CHECK (fill_pct BETWEEN 0 AND 100),
  locked             boolean NOT NULL DEFAULT false,
  lock_reason        text CHECK (lock_reason IN ('full','manual')),
  device_locked      boolean,                              -- what the device last reported
  empty_distance_cm  real NOT NULL DEFAULT 60,             -- sensor to bottom when empty
  full_distance_cm   real NOT NULL DEFAULT 8,              -- sensor to waste when 100% full
  lock_threshold     smallint NOT NULL DEFAULT 90,
  unlock_threshold   smallint NOT NULL DEFAULT 30,
  near_full_threshold smallint NOT NULL DEFAULT 75,
  locked_at          timestamptz,
  updated_at         timestamptz,
  UNIQUE (station_id, stream)
);

CREATE TABLE readings (
  id           bigserial PRIMARY KEY,
  station_id   uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  stream       text NOT NULL,
  fill_pct     smallint NOT NULL,
  distance_cm  real,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX readings_station_time_idx ON readings(station_id, recorded_at DESC);

CREATE TABLE pickups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id        uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  stream            text NOT NULL CHECK (stream IN ('general','recyclable','organic')),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','assigned','en_route','completed','cancelled')),
  collector_org_id  uuid REFERENCES organizations(id) ON DELETE SET NULL,
  collector_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source            text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  fill_at_request   smallint,
  eta               timestamptz,
  weight_kg         real,
  material          text,
  notes             text,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  assigned_at       timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX pickups_status_idx ON pickups(status);
CREATE INDEX pickups_station_idx ON pickups(station_id);
-- Only one open pickup per compartment at a time
CREATE UNIQUE INDEX pickups_one_open ON pickups(station_id, stream) WHERE status IN ('pending','assigned','en_route');

-- In-app notifications, one row per recipient
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id  uuid REFERENCES stations(id) ON DELETE CASCADE,
  category    text NOT NULL CHECK (category IN ('bin','pickup','reward','system')),
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE problem_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id   uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  category     text NOT NULL CHECK (category IN ('overflow','damaged','odour','sensor','blocked','other')),
  description  text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX problem_reports_status_idx ON problem_reports(status);

CREATE TABLE points_ledger (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id  uuid REFERENCES stations(id) ON DELETE SET NULL,
  amount      integer NOT NULL,
  reason      text NOT NULL,
  stream      text,
  weight_kg   real,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX points_ledger_user_idx ON points_ledger(user_id, created_at DESC);

-- Sorted material batches that recyclers can reserve
CREATE TABLE batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material          text NOT NULL CHECK (material IN ('pet','hdpe','nylon','paper','metal','glass','organic','mixed')),
  weight_kg         real NOT NULL CHECK (weight_kg > 0),
  area              text NOT NULL DEFAULT '',
  station_id        uuid REFERENCES stations(id) ON DELETE SET NULL,
  pickup_id         uuid REFERENCES pickups(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','collected')),
  reserved_by_org   uuid REFERENCES organizations(id) ON DELETE SET NULL,
  reserved_by_user  uuid REFERENCES users(id) ON DELETE SET NULL,
  reserved_at       timestamptz,
  collected_at      timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX batches_status_idx ON batches(status);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  meta        jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_time_idx ON audit_log(created_at DESC);
