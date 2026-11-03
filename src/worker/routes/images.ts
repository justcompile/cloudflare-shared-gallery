import type { Ctx, Router } from "../router";
import { error, json, noContent, readJson } from "../lib/json";
import {
  ALLOWED_MEDIA_TYPES,
  MAX_UPLOAD_BYTES,
  generateR2Key,
  sanitizeOriginalName,
} from "../lib/r2";
import { extractDimensions, sniffMediaType } from "../lib/imageMeta";
import { EXIF_SCAN_BYTES, parseExif } from "../lib/exif";
import {
  clampLimit,
  getImage,
  getImageMemberships,
  insertImage,
  listDeletedImages,
  listImages,
  purgeExpiredDeletions,
  restoreImage,
  softDeleteImage,
  softDeleteImages,
  updateImageCaption,
} from "../db/queries";
import { isImageSort, type ApiImageDetail, type ImageFilter } from "../../shared/types";

export function registerImageRoutes(router: Router): void {
  router.post("/api/images", upload);
  router.get("/api/images", list);
  router.post("/api/images/bulk-delete", bulkRemove);
  // Registered before :id so the literal path wins the match.
  router.get("/api/images/deleted", deletedList);
  router.get("/api/images/:id", detail);
  router.patch("/api/images/:id", patch);
  router.delete("/api/images/:id", remove);
  router.post("/api/images/:id/restore", restore);
}

/**
 * POST /api/images — one media file per request, raw streamed body.
 * The body streams straight into R2 (never buffered into Worker memory);
 * magic bytes are then range-read back for content verification, and
 * dimensions come from the free Images `.info()` call.
 */
async function upload(ctx: Ctx): Promise<Response> {
  // Attribution must never be blank on writes (PRD section 6).
  if (!ctx.displayName) {
    return error("Set a display name before uploading", 400);
  }

  const contentType = (ctx.req.headers.get("Content-Type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_MEDIA_TYPES[contentType]) {
    return error("Only JPEG, PNG, GIF, WebP, AVIF, MP4, WebM, or QuickTime files can be uploaded", 415);
  }

  const declaredSize = Number.parseInt(ctx.req.headers.get("Content-Length") ?? "", 10);
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    return error("Missing upload size", 411);
  }
  if (declaredSize > MAX_UPLOAD_BYTES) {
    return error("File exceeds the 100 MB upload limit", 413);
  }
  if (!ctx.req.body) return error("Empty upload body", 400);

  const id = crypto.randomUUID();
  const key = generateR2Key(id, contentType);
  const originalName = sanitizeOriginalName(
    ctx.req.headers.get("X-Original-Name"),
    `upload.${ALLOWED_MEDIA_TYPES[contentType]}`,
  );

  const stored = await ctx.env.BUCKET.put(key, ctx.req.body, {
    httpMetadata: { contentType },
  });
  if (!stored) {
    return error("Upload failed, please retry", 500);
  }

  // Verify the payload really is the declared media type via magic bytes.
  const head = await ctx.env.BUCKET.get(key, { range: { offset: 0, length: 32 } });
  const headBytes = head ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array(0);
  const sniffed = sniffMediaType(headBytes);
  if (sniffed !== contentType) {
    await ctx.env.BUCKET.delete(key);
    return error("File content does not match its declared media type", 415);
  }

  const isImage = contentType.startsWith("image/");
  const dims = isImage ? await extractDimensions(ctx.env, key) : null;

  // Index capture metadata from the EXIF header (the R2 original keeps the
  // full metadata regardless).
  let exif = { takenAt: null as number | null, camera: null as string | null };
  if (contentType === "image/jpeg") {
    const head2 = await ctx.env.BUCKET.get(key, {
      range: { offset: 0, length: Math.min(EXIF_SCAN_BYTES, stored.size) },
    });
    if (head2) exif = parseExif(new Uint8Array(await head2.arrayBuffer()));
  }

  const now = Date.now();
  await insertImage(ctx.env.DB, {
    id,
    r2Key: key,
    originalName,
    contentType,
    sizeBytes: stored.size,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    uploadedBy: ctx.displayName,
    takenAt: exif.takenAt,
    camera: exif.camera,
    createdAt: now,
  });

  const image = await getImage(ctx.env.DB, id);
  return json(image, 201);
}

/** GET /api/images?filter=all|untagged&cursor=&limit= */
async function list(ctx: Ctx): Promise<Response> {
  const filterRaw = ctx.url.searchParams.get("filter") ?? "all";
  if (filterRaw !== "all" && filterRaw !== "untagged") {
    return error("filter must be 'all' or 'untagged'", 400);
  }
  const sortRaw = ctx.url.searchParams.get("sort") ?? "newest";
  if (!isImageSort(sortRaw)) {
    return error("sort is not supported", 400);
  }
  const uploader = ctx.url.searchParams.get("uploader")?.trim().slice(0, 40) || null;
  const page = await listImages(ctx.env.DB, {
    filter: filterRaw as ImageFilter,
    sort: sortRaw,
    cursor: ctx.url.searchParams.get("cursor"),
    limit: clampLimit(ctx.url.searchParams.get("limit")),
    uploader,
  });
  return json(page);
}

/** GET /api/images/:id — single image with its collection memberships. */
async function detail(ctx: Ctx): Promise<Response> {
  const image = await getImage(ctx.env.DB, ctx.params.id);
  if (!image) return error("Image not found", 404);
  const collections = await getImageMemberships(ctx.env.DB, image.id);
  const body: ApiImageDetail = { ...image, collections };
  return json(body);
}

/** PATCH /api/images/:id — update caption (doubles as alt text). */
async function patch(ctx: Ctx): Promise<Response> {
  const body = await readJson<{ caption?: unknown }>(ctx.req);
  if (!body || !("caption" in body)) return error("caption is required", 400);
  if (body.caption !== null && typeof body.caption !== "string") {
    return error("caption must be a string or null", 400);
  }
  const caption =
    typeof body.caption === "string" ? body.caption.trim().slice(0, 500) : null;
  const updated = await updateImageCaption(
    ctx.env.DB,
    ctx.params.id,
    caption && caption.length > 0 ? caption : null,
    Date.now(),
  );
  if (!updated) return error("Image not found", 404);
  return detail(ctx);
}

/**
 * DELETE /api/images/:id — soft delete. The photo moves to Recently deleted
 * (R2 object and collection memberships kept) and is only purged for real
 * 30 days later. There is deliberately no user-facing permanent delete.
 */
async function remove(ctx: Ctx): Promise<Response> {
  const marked = await softDeleteImage(ctx.env.DB, ctx.params.id, ctx.displayName, Date.now());
  if (!marked) return error("Image not found", 404);
  return noContent();
}

/** POST /api/images/bulk-delete — soft-delete up to 200 selected items. */
async function bulkRemove(ctx: Ctx): Promise<Response> {
  const body = await readJson<{ imageIds?: unknown }>(ctx.req);
  const ids = body?.imageIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    return error("imageIds must be a non-empty array of image ids", 400);
  }
  if (ids.length > 200) return error("At most 200 items per request", 400);

  const deleted = await softDeleteImages(
    ctx.env.DB,
    [...new Set(ids as string[])],
    ctx.displayName,
    Date.now(),
  );
  return json({ deleted });
}

/** POST /api/images/:id/restore — bring a photo back from Recently deleted. */
async function restore(ctx: Ctx): Promise<Response> {
  const restored = await restoreImage(ctx.env.DB, ctx.params.id, Date.now());
  if (!restored) return error("Image is not in Recently deleted", 404);
  return json(await getImage(ctx.env.DB, ctx.params.id));
}

/** GET /api/images/deleted — Recently deleted, newest first. */
async function deletedList(ctx: Ctx): Promise<Response> {
  // Opportunistic purge of items past the recovery window; off the hot path.
  ctx.exec.waitUntil(purgeExpiredDeletions(ctx.env.DB, ctx.env.BUCKET, Date.now()));
  return json(await listDeletedImages(ctx.env.DB));
}
