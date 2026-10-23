CREATE TABLE IF NOT EXISTS workout_routines (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  profile_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(120) NOT NULL,
  notes TEXT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at VARCHAR(24) NOT NULL,
  updated_at VARCHAR(24) NOT NULL,
  INDEX workout_owner (profile_id, updated_at),
  CONSTRAINT workout_profile_fk FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workout_routine_exercises (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  routine_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  import_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  exercise_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  UNIQUE KEY workout_exercise_order (routine_id, position),
  CONSTRAINT workout_routine_fk FOREIGN KEY (routine_id) REFERENCES workout_routines(id) ON DELETE CASCADE,
  CONSTRAINT workout_catalog_fk FOREIGN KEY (import_id, exercise_id) REFERENCES gymfit_exercises(import_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workout_routine_sets (
  exercise_entry_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  repetitions SMALLINT UNSIGNED NOT NULL,
  load_kg DECIMAL(8,2) NULL,
  rest_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 90,
  PRIMARY KEY (exercise_entry_id, position),
  CONSTRAINT workout_set_entry_fk FOREIGN KEY (exercise_entry_id) REFERENCES workout_routine_exercises(id) ON DELETE CASCADE,
  CONSTRAINT workout_set_repetitions CHECK (repetitions BETWEEN 1 AND 1000),
  CONSTRAINT workout_set_load CHECK (load_kg IS NULL OR load_kg BETWEEN 0 AND 10000),
  CONSTRAINT workout_set_rest CHECK (rest_seconds BETWEEN 0 AND 3600)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
