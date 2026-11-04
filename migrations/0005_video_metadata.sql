-- Migration 0005: indexed video duration.
ALTER TABLE images ADD COLUMN duration_ms INTEGER;
