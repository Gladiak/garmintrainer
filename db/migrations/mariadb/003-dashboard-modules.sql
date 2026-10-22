CREATE TABLE IF NOT EXISTS dashboard_layouts (
  profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  payload TEXT NOT NULL,
  CONSTRAINT dashboard_layout_profile FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE garmin_sync_state
  ADD COLUMN IF NOT EXISTS range_lookup CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS credential_revision INT NOT NULL DEFAULT 0;

UPDATE garmin_sync_state AS state
  JOIN profiles AS profile ON profile.id = state.profile_id
  SET state.credential_revision = profile.credential_revision
  WHERE state.range_lookup = '';

ALTER TABLE garmin_sync_state DROP PRIMARY KEY,
  ADD PRIMARY KEY (profile_id, resource, range_lookup);
