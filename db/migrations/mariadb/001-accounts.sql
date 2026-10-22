CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  username TEXT NOT NULL,
  username_lookup CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  email TEXT NOT NULL,
  email_lookup CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  password_hash VARCHAR(255) CHARACTER SET ascii NOT NULL,
  created_at VARCHAR(24) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS profiles (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  first_name TEXT NULL,
  last_name TEXT NULL,
  primary_sport VARCHAR(20) NULL,
  avatar MEDIUMTEXT NULL,
  theme VARCHAR(40) NOT NULL DEFAULT 'sage-ivory',
  language VARCHAR(2) NOT NULL DEFAULT 'en',
  garmin_key TEXT NULL,
  credential_revision INT NOT NULL DEFAULT 0,
  created_at VARCHAR(24) NOT NULL,
  updated_at VARCHAR(24) NOT NULL,
  CONSTRAINT profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  csrf_token CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX session_expiry (expires_at),
  CONSTRAINT sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS planned_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(120) NOT NULL,
  sport VARCHAR(20) NOT NULL,
  date CHAR(10) NOT NULL,
  time VARCHAR(5) NOT NULL DEFAULT '',
  duration_minutes INT NOT NULL,
  notes TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'planned',
  created_at VARCHAR(24) NOT NULL,
  updated_at VARCHAR(24) NOT NULL,
  INDEX profile_date (profile_id, date),
  CONSTRAINT plan_profile FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT duration_valid CHECK (duration_minutes BETWEEN 1 AND 1440),
  CONSTRAINT status_valid CHECK (status IN ('planned', 'completed'))
) ENGINE=InnoDB;
