/**
 * Media content checks and image dimension extraction on upload.
 *
 * Dimensions come from the Images binding's `.info()` (free — it does not
 * count against the 5,000 transformations/30 days allowance). Content-type
 * verification uses magic-byte sniffing on the first bytes so a non-media
 * payload with a spoofed Content-Type header is rejected.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Sniffs the real content type from the first bytes of the object. */
export function sniffMediaType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  // AVIF/HEIF family: box "ftyp" at offset 4 with brand avif/avis
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "qt  ") return "video/quicktime";
    if (
      brand.startsWith("iso") ||
      ["mp41", "mp42", "avc1", "M4V ", "M4VH", "M4VP", "MSNV", "dash", "cmfc", "cmfs"].includes(
        brand,
      )
    ) {
      return "video/mp4";
    }
  }
  // WebM and Matroska share the EBML header signature.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "video/webm";
  }
  return null;
}

/**
 * Reads dimensions via the Images binding. Returns null when the binding
 * cannot parse the object (e.g. originals beyond its 20 MB input limit, or
 * formats the local dev simulator does not support) — dimensions are
 * nice-to-have metadata, never a reason to fail an upload.
 */
export async function extractDimensions(
  env: Env,
  key: string,
): Promise<ImageDimensions | null> {
  try {
    const obj = await env.BUCKET.get(key);
    if (!obj) return null;
    const info = await env.IMAGES.info(obj.body);
    if ("width" in info && typeof info.width === "number" && typeof info.height === "number") {
      return { width: info.width, height: info.height };
    }
    return null;
  } catch {
    return null;
  }
}
