ALTER TABLE profiles ADD COLUMN language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'it', 'fr', 'es', 'de'));
PRAGMA user_version = 5;
