-- Keep original English names and remove the retired localized columns.
-- IF EXISTS makes this safe after manual production maintenance or interrupted DDL.
ALTER TABLE gymfit_muscle_groups
  DROP COLUMN IF EXISTS name_it,
  DROP COLUMN IF EXISTS name_fr,
  DROP COLUMN IF EXISTS name_es,
  DROP COLUMN IF EXISTS name_de;

ALTER TABLE gymfit_muscles
  DROP COLUMN IF EXISTS name_it,
  DROP COLUMN IF EXISTS name_fr,
  DROP COLUMN IF EXISTS name_es,
  DROP COLUMN IF EXISTS name_de;

ALTER TABLE gymfit_exercises
  DROP COLUMN IF EXISTS name_it,
  DROP COLUMN IF EXISTS name_fr,
  DROP COLUMN IF EXISTS name_es,
  DROP COLUMN IF EXISTS name_de;
