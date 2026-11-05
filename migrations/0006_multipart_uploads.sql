CREATE TABLE upload_sessions (
  id              TEXT PRIMARY KEY,
  r2_key          TEXT NOT NULL UNIQUE,
  r2_upload_id    TEXT NOT NULL UNIQUE,
  original_name   TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  uploaded_by     TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
