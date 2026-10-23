ALTER TABLE gymfit_exercise_muscles
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (import_id, exercise_id, muscle_id, role);
