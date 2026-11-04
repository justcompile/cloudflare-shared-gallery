-- Migration 0004: browser-generated video poster thumbnails stored in R2.
ALTER TABLE images ADD COLUMN thumbnail_key TEXT;
