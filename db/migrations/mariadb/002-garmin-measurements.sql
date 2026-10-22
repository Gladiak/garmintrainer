CREATE TABLE IF NOT EXISTS garmin_connections (
  profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identity_lookup CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  credential_revision INT NOT NULL,
  payload TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT garmin_connection_profile FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS garmin_measurements (
  profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  connection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource VARCHAR(16) CHARACTER SET ascii NOT NULL,
  day_lookup CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload MEDIUMTEXT NOT NULL,
  fetched_at BIGINT NOT NULL,
  PRIMARY KEY (profile_id, connection_id, resource, day_lookup),
  CONSTRAINT garmin_measurement_profile FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS garmin_sync_state (
  profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource VARCHAR(16) CHARACTER SET ascii NOT NULL,
  error_code VARCHAR(64) CHARACTER SET ascii NULL,
  retry_at BIGINT NULL,
  last_attempt_at BIGINT NOT NULL,
  PRIMARY KEY (profile_id, resource),
  CONSTRAINT garmin_state_profile FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS garmin_sync_locks (
  profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  owner CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at BIGINT NOT NULL,
  CONSTRAINT garmin_lock_profile FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;
