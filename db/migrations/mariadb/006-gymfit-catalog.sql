CREATE TABLE IF NOT EXISTS gymfit_imports (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'running',
  active_slot TINYINT UNSIGNED NULL,
  api_version SMALLINT UNSIGNED NOT NULL DEFAULT 2,
  checkpoint_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  request_budget SMALLINT UNSIGNED NOT NULL DEFAULT 900,
  requests_started INT UNSIGNED NOT NULL DEFAULT 0,
  requests_succeeded INT UNSIGNED NOT NULL DEFAULT 0,
  requests_per_minute SMALLINT UNSIGNED NOT NULL DEFAULT 20,
  next_request_at BIGINT NULL,
  quota_remaining INT UNSIGNED NULL,
  quota_reset_at BIGINT NULL,
  expected_exercises INT UNSIGNED NULL,
  expected_muscles INT UNSIGNED NULL,
  expected_groups INT UNSIGNED NULL,
  catalog_complete BOOLEAN NOT NULL DEFAULT 0,
  muscle_map_complete BOOLEAN NOT NULL DEFAULT 0,
  reference_data JSON NOT NULL,
  checkpoint JSON NOT NULL,
  last_error_code VARCHAR(64) CHARACTER SET ascii NULL,
  last_request_id VARCHAR(255) CHARACTER SET ascii NULL,
  started_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  finished_at BIGINT NULL,
  published_at BIGINT NULL,
  UNIQUE KEY gymfit_one_active_catalog (active_slot),
  CONSTRAINT gymfit_import_status CHECK (status IN ('running', 'paused', 'waiting_quota', 'completed', 'failed')),
  CONSTRAINT gymfit_import_budget CHECK (request_budget BETWEEN 1 AND 1000),
  CONSTRAINT gymfit_import_rate CHECK (requests_per_minute BETWEEN 1 AND 30),
  CONSTRAINT gymfit_import_counters CHECK (requests_succeeded <= requests_started AND requests_started <= request_budget),
  CONSTRAINT gymfit_import_catalog_flag CHECK (catalog_complete IN (0, 1)),
  CONSTRAINT gymfit_import_map_flag CHECK (muscle_map_complete IN (0, 1)),
  CONSTRAINT gymfit_import_reference_object CHECK (JSON_TYPE(reference_data) = 'OBJECT'),
  CONSTRAINT gymfit_import_checkpoint_object CHECK (JSON_TYPE(checkpoint) = 'OBJECT'),
  CONSTRAINT gymfit_import_completed CHECK (
    status <> 'completed' OR (
      catalog_complete = 1 AND muscle_map_complete = 1 AND
      expected_exercises IS NOT NULL AND expected_muscles IS NOT NULL AND
      expected_groups IS NOT NULL AND finished_at IS NOT NULL
    )
  ),
  CONSTRAINT gymfit_import_active CHECK (
    active_slot IS NULL OR (active_slot = 1 AND status = 'completed' AND published_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gymfit_muscle_groups (
  import_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(255) NOT NULL,
  name_it VARCHAR(255) NULL,
  name_fr VARCHAR(255) NULL,
  name_es VARCHAR(255) NULL,
  name_de VARCHAR(255) NULL,
  source_payload JSON NOT NULL,
  PRIMARY KEY (import_id, id),
  CONSTRAINT gymfit_group_payload CHECK (JSON_TYPE(source_payload) = 'OBJECT'),
  CONSTRAINT gymfit_group_import_fk FOREIGN KEY (import_id) REFERENCES gymfit_imports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gymfit_muscles (
  import_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  group_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  name VARCHAR(255) NOT NULL,
  name_it VARCHAR(255) NULL,
  name_fr VARCHAR(255) NULL,
  name_es VARCHAR(255) NULL,
  name_de VARCHAR(255) NULL,
  common_name VARCHAR(255) NULL,
  body_part VARCHAR(32) NULL,
  source_payload JSON NOT NULL,
  PRIMARY KEY (import_id, id),
  INDEX gymfit_muscle_group (import_id, group_id),
  CONSTRAINT gymfit_muscle_payload CHECK (JSON_TYPE(source_payload) = 'OBJECT'),
  CONSTRAINT gymfit_muscle_import_fk FOREIGN KEY (import_id) REFERENCES gymfit_imports(id) ON DELETE CASCADE,
  CONSTRAINT gymfit_muscle_group_fk FOREIGN KEY (import_id, group_id) REFERENCES gymfit_muscle_groups(import_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gymfit_exercises (
  import_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  name VARCHAR(255) NOT NULL,
  name_it VARCHAR(255) NULL,
  name_fr VARCHAR(255) NULL,
  name_es VARCHAR(255) NULL,
  name_de VARCHAR(255) NULL,
  equipment VARCHAR(64) NULL,
  body_part VARCHAR(32) NULL,
  category VARCHAR(32) NULL,
  difficulty VARCHAR(32) NULL,
  tracking_type VARCHAR(32) NULL,
  source_payload JSON NOT NULL,
  catalog_seen BOOLEAN NOT NULL DEFAULT 0,
  fetched_at BIGINT NOT NULL,
  PRIMARY KEY (import_id, id),
  UNIQUE KEY gymfit_exercise_slug (import_id, slug),
  INDEX gymfit_exercise_name (import_id, name),
  INDEX gymfit_exercise_equipment (import_id, equipment),
  INDEX gymfit_exercise_category (import_id, category, difficulty),
  CONSTRAINT gymfit_exercise_payload CHECK (JSON_TYPE(source_payload) = 'OBJECT'),
  CONSTRAINT gymfit_exercise_import_fk FOREIGN KEY (import_id) REFERENCES gymfit_imports(id) ON DELETE CASCADE,
  CONSTRAINT gymfit_exercise_catalog_seen CHECK (catalog_seen IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gymfit_exercise_muscles (
  import_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  exercise_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  muscle_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (import_id, exercise_id, muscle_id),
  INDEX gymfit_muscle_exercises (import_id, muscle_id, role, exercise_id),
  CONSTRAINT gymfit_em_exercise_fk FOREIGN KEY (import_id, exercise_id)
    REFERENCES gymfit_exercises(import_id, id) ON DELETE CASCADE,
  CONSTRAINT gymfit_em_muscle_fk FOREIGN KEY (import_id, muscle_id)
    REFERENCES gymfit_muscles(import_id, id) ON DELETE CASCADE,
  CONSTRAINT gymfit_em_role CHECK (role IN ('target', 'synergist'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
