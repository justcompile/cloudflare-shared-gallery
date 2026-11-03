/** Content types accepted for upload, mapped to the R2 key extension. */
export const ALLOWED_MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MiB (Worker request body cap is 100 MB)

/**
 * Generates the R2 object key for a new upload. Always server-generated —
 * never derived from the user-supplied filename.
 */
export function generateR2Key(imageId: string, contentType: string): string {
  return `${imageId}.${ALLOWED_MEDIA_TYPES[contentType] ?? "bin"}`;
}

/** Sanitizes the client-declared original filename (display metadata only). */
export function sanitizeOriginalName(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // keep raw
  }
  name = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replaceAll("/", "_")
    .replaceAll("\\", "_")
    .trim()
    .slice(0, 200);
  return name.length > 0 ? name : fallback;
}
