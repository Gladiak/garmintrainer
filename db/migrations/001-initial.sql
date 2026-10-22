CREATE TABLE IF NOT EXISTS planned_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sport TEXT NOT NULL CHECK (sport IN ('running', 'cycling', 'strength', 'walking', 'mobility', 'swimming')),
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS planned_sessions_date ON planned_sessions(date, time);
PRAGMA user_version = 1;
