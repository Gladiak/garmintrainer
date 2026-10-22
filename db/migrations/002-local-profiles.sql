CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  primary_sport TEXT CHECK (primary_sport IN ('running', 'cycling', 'swimming', 'gym', 'hiit')),
  garmin_key TEXT,
  credential_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE app_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
ALTER TABLE planned_sessions ADD COLUMN profile_id TEXT REFERENCES profiles(id);
CREATE INDEX planned_sessions_profile_date ON planned_sessions(profile_id, date, time);
PRAGMA user_version = 2;
