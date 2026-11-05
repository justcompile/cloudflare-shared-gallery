import type { Ctx, Router } from "../router";
import { error, json, noContent, readJson } from "../lib/json";
import {
  ALLOWED_MEDIA_TYPES,
  generateR2Key,
  sanitizeOriginalName,
} from "../lib/r2";
import { extractDimensions, sniffMediaType } from "../lib/imageMeta";
import { EXIF_SCAN_BYTES, parseExif } from "../lib/exif";
import {
  deleteUploadSession,
  clampLimit,
  getUploadSession,
  getImage,
  getImageMemberships,
  insertImage,
  insertUploadSession,
  listDeletedImages,
  listImages,
  purgeExpiredDeletions,
  restoreImage,
  softDeleteImage,
  softDeleteImages,
  updateVideoThumbnail,
  updateImageMetadata,
  updateImageCaptureDate,
  updateImageCaption,
} from "../db/queries";
import { isImageSort, type ApiImageDetail, type ImageFilter } from "../../shared/types";
import { MAX_UPLOAD_BYTES, MULTIPART_CHUNK_BYTES } from "../../shared/upload";

export function registerImageRoutes(router: Router): void {
  router.post("/api/images", upload);
  router.post("/api/uploads", startMultipartUpload);
  router.post("/api/uploads/:id/parts/:partNumber", uploadMultipartPart);
  router.post("/api/uploads/:id/complete", completeMultipartUpload);
  router.delete("/api/uploads/:id", abortMultipartUpload);
  router.get("/api/images", list);
  router.post("/api/images/bulk-delete", bulkRemove);
  router.post("/api/images/:id/thumbnail", setVideoThumbnail);
  router.post("/api/images/:id/reprocess-metadata", reprocessMetadata);
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

  const contentLength = ctx.req.headers.get("Content-Length");
  const declaredSize = contentLength === null ? Number.NaN : Number(contentLength);
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
    return error("Missing upload size", 411);
  }
  if (declaredSize > MAX_UPLOAD_BYTES) {
    return error("File exceeds the 200 MB upload limit", 413);
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

  return finalizeUpload(ctx, {
    id,
    r2Key: key,
    originalName,
    contentType,
    sizeBytes: stored.size,
    uploadedBy: ctx.displayName,
  });
}

interface MultipartStartInput {
  contentType: string;
  originalName: string;
  sizeBytes: number;
}

async function startMultipartUpload(ctx: Ctx): Promise<Response> {
  if (!ctx.displayName) return error("Set a display name before uploading", 400);
  const input = await readJson<MultipartStartInput>(ctx.req);
  if (
    !input ||
    typeof input.contentType !== "string" ||
    typeof input.sizeBytes !== "number" ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0
  ) {
    return error("Invalid multipart upload details", 400);
  }
  const contentType = input.contentType.trim().toLowerCase();
  if (!ALLOWED_MEDIA_TYPES[contentType]) {
    return error("Unsupported media type", 415);
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    return error("File exceeds the 200 MB upload limit", 413);
  }

  const id = crypto.randomUUID();
  const r2Key = generateR2Key(id, contentType);
  const multipart = await ctx.env.BUCKET.createMultipartUpload(r2Key, {
    httpMetadata: { contentType },
  });
  const session = {
    id,
    r2Key,
    r2UploadId: multipart.uploadId,
    originalName: sanitizeOriginalName(
      typeof input.originalName === "string" ? input.originalName : null,
      `upload.${ALLOWED_MEDIA_TYPES[contentType]}`,
    ),
    contentType,
    sizeBytes: input.sizeBytes,
    uploadedBy: ctx.displayName,
  };
  try {
    await insertUploadSession(ctx.env.DB, session, Date.now());
  } catch (err) {
    try {
      await multipart.abort();
    } catch (abortErr) {
      console.error("Could not abort multipart upload after session creation failed", {
        key: r2Key,
        abortErr,
      });
    }
    throw err;
  }

  return json({ id, chunkSize: MULTIPART_CHUNK_BYTES }, 201);
}

async function uploadMultipartPart(ctx: Ctx): Promise<Response> {
  const session = await getUploadSession(ctx.env.DB, ctx.params.id);
  if (!session) return error("Upload session not found", 404);
  const partNumber = Number(ctx.params.partNumber);
  const partCount = Math.ceil(session.sizeBytes / MULTIPART_CHUNK_BYTES);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount) {
    return error("Invalid multipart part number", 400);
  }
  const expectedSize = Math.min(
    MULTIPART_CHUNK_BYTES,
    session.sizeBytes - (partNumber - 1) * MULTIPART_CHUNK_BYTES,
  );
  const contentLength = Number(ctx.req.headers.get("Content-Length"));
  if (!Number.isSafeInteger(contentLength) || contentLength !== expectedSize) {
    return error("Multipart part size does not match the expected size", 400);
  }
  if (!ctx.req.body) return error("Empty multipart part", 400);

  const multipart = ctx.env.BUCKET.resumeMultipartUpload(session.r2Key, session.r2UploadId);
  const uploadedPart = await multipart.uploadPart(partNumber, ctx.req.body);
  return json({ partNumber, etag: uploadedPart.etag });
}

interface MultipartCompleteInput {
  parts: Array<{ partNumber: number; etag: string }>;
}

async function completeMultipartUpload(ctx: Ctx): Promise<Response> {
  const session = await getUploadSession(ctx.env.DB, ctx.params.id);
  if (!session) return error("Upload session not found", 404);
  const input = await readJson<MultipartCompleteInput>(ctx.req);
  const partCount = Math.ceil(session.sizeBytes / MULTIPART_CHUNK_BYTES);
  if (
    !input ||
    !Array.isArray(input.parts) ||
    input.parts.length !== partCount ||
    input.parts.some(
      (part, index) =>
        !part ||
        part.partNumber !== index + 1 ||
        typeof part.etag !== "string" ||
        part.etag.length === 0,
    )
  ) {
    return error("Invalid multipart completion details", 400);
  }

  const multipart = ctx.env.BUCKET.resumeMultipartUpload(session.r2Key, session.r2UploadId);
  const stored = await multipart.complete(input.parts);
  if (stored.size !== session.sizeBytes) {
    await ctx.env.BUCKET.delete(session.r2Key);
    await deleteUploadSession(ctx.env.DB, session.id);
    return error("Uploaded file size does not match the declared size", 400);
  }

  try {
    const response = await finalizeUpload(ctx, session);
    await deleteUploadSession(ctx.env.DB, session.id);
    return response;
  } catch (err) {
    // Keep an object already indexed in D1 intact if only session cleanup failed.
    const imageExists = await getImage(ctx.env.DB, session.id).catch((lookupErr: unknown) => {
      console.error("Could not check image after multipart completion failed", {
        id: session.id,
        lookupErr,
      });
      return true;
    });
    if (!imageExists) {
      try {
        await ctx.env.BUCKET.delete(session.r2Key);
        await deleteUploadSession(ctx.env.DB, session.id);
      } catch (cleanupErr) {
        console.error("Could not clean up completed multipart upload", {
          key: session.r2Key,
          cleanupErr,
        });
      }
    }
    throw err;
  }
}

async function abortMultipartUpload(ctx: Ctx): Promise<Response> {
  const session = await getUploadSession(ctx.env.DB, ctx.params.id);
  if (!session) return noContent();
  const multipart = ctx.env.BUCKET.resumeMultipartUpload(session.r2Key, session.r2UploadId);
  await multipart.abort();
  await deleteUploadSession(ctx.env.DB, session.id);
  return noContent();
}

async function finalizeUpload(
  ctx: Ctx,
  upload: {
    id: string;
    r2Key: string;
    originalName: string;
    contentType: string;
    sizeBytes: number;
    uploadedBy: string | null;
  },
): Promise<Response> {
  const head = await ctx.env.BUCKET.get(upload.r2Key, { range: { offset: 0, length: 32 } });
  const headBytes = head ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array(0);
  if (sniffMediaType(headBytes) !== upload.contentType) {
    await ctx.env.BUCKET.delete(upload.r2Key);
    return error("File content does not match its declared media type", 415);
  }

  const isImage = upload.contentType.startsWith("image/");
  const dims = isImage ? await extractDimensions(ctx.env, upload.r2Key) : null;
  let exif = { takenAt: null as number | null, camera: null as string | null };
  if (upload.contentType === "image/jpeg") {
    const head2 = await ctx.env.BUCKET.get(upload.r2Key, {
      range: { offset: 0, length: Math.min(EXIF_SCAN_BYTES, upload.sizeBytes) },
    });
    if (head2) exif = parseExif(new Uint8Array(await head2.arrayBuffer()));
  }

  await insertImage(ctx.env.DB, {
    id: upload.id,
    r2Key: upload.r2Key,
    originalName: upload.originalName,
    contentType: upload.contentType,
    sizeBytes: upload.sizeBytes,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    uploadedBy: upload.uploadedBy,
    takenAt: exif.takenAt,
    camera: exif.camera,
    createdAt: Date.now(),
  });
  const image = await getImage(ctx.env.DB, upload.id);
  return json(image, 201);
}

/** GET /api/images?filter=all|untagged&cursor=&limit= */
async function list(ctx: Ctx): Promise<Response> {
  const filterRaw = ctx.url.searchParams.get("filter") ?? "all";
  if (filterRaw !== "all" && filterRaw !== "untagged") {
    return error("filter must be 'all' or 'untagged'", 400);
  }
  const sortRaw = ctx.url.searchParams.get("sort") ?? "capture-oldest";
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

/** POST /api/images/:id/thumbnail — save a browser-generated JPEG video poster. */
async function setVideoThumbnail(ctx: Ctx): Promise<Response> {
  const image = await getImage(ctx.env.DB, ctx.params.id);
  if (!image) return error("Media item not found", 404);
  if (!image.contentType.startsWith("video/")) {
    return error("Thumbnails can only be set for videos", 415);
  }
  if ((ctx.req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase() !== "image/jpeg") {
    return error("Thumbnail must be a JPEG image", 415);
  }

  const declaredSize = Number.parseInt(ctx.req.headers.get("Content-Length") ?? "", 10);
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    return error("Missing thumbnail size", 411);
  }
  const maxBytes = 5 * 1024 * 1024;
  if (declaredSize > maxBytes) {
    return error("Thumbnail exceeds the 5 MB limit", 413);
  }
  if (!ctx.req.body) return error("Empty thumbnail body", 400);

  const thumbnailKey = generateR2Key(
    `${image.id}-thumbnail-${crypto.randomUUID()}`,
    "image/jpeg",
  );
  const stored = await ctx.env.BUCKET.put(thumbnailKey, ctx.req.body, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  if (!stored) return error("Thumbnail upload failed, please retry", 500);
  if (stored.size > maxBytes) {
    await ctx.env.BUCKET.delete(thumbnailKey);
    return error("Thumbnail exceeds the 5 MB limit", 413);
  }

  const head = await ctx.env.BUCKET.get(thumbnailKey, { range: { offset: 0, length: 32 } });
  const sniffed = head
    ? sniffMediaType(new Uint8Array(await head.arrayBuffer()))
    : null;
  if (sniffed !== "image/jpeg") {
    await ctx.env.BUCKET.delete(thumbnailKey);
    return error("Thumbnail content is not a valid JPEG image", 415);
  }

  const updated = await updateVideoThumbnail(ctx.env.DB, image.id, thumbnailKey, Date.now());
  if (!updated) {
    await ctx.env.BUCKET.delete(thumbnailKey);
    return error("Video not found", 404);
  }
  if (image.thumbnailKey) {
    ctx.exec.waitUntil(
      ctx.env.BUCKET.delete(image.thumbnailKey).catch((err: unknown) => {
        console.error("Could not remove superseded video thumbnail", {
          key: image.thumbnailKey,
          err,
        });
      }),
    );
  }
  const result = await getImage(ctx.env.DB, image.id);
  if (!result) return error("Video not found", 404);
  return json(result);
}

/** POST /api/images/:id/reprocess-metadata — refresh indexed media metadata. */
async function reprocessMetadata(ctx: Ctx): Promise<Response> {
  const image = await getImage(ctx.env.DB, ctx.params.id);
  if (!image) return error("Media item not found", 404);
  if (!(await ctx.env.BUCKET.head(image.mediaKey))) {
    return error("Original media file not found", 404);
  }

  let metadata: {
    width: number | null;
    height: number | null;
    takenAt: number | null;
    camera: string | null;
    durationMs: number | null;
  };

  if (image.contentType.startsWith("image/")) {
    const dimensions = await extractDimensions(ctx.env, image.mediaKey);
    let exif = { takenAt: null as number | null, camera: null as string | null };
    if (image.contentType === "image/jpeg") {
      const object = await ctx.env.BUCKET.get(image.mediaKey, {
        range: { offset: 0, length: Math.min(EXIF_SCAN_BYTES, image.sizeBytes) },
      });
      if (!object) return error("Original media file not found", 404);
      exif = parseExif(new Uint8Array(await object.arrayBuffer()));
    }
    metadata = {
      width: dimensions?.width ?? image.width,
      height: dimensions?.height ?? image.height,
      takenAt: exif.takenAt ?? image.takenAt,
      camera: exif.camera ?? image.camera,
      durationMs: null,
    };
  } else if (image.contentType.startsWith("video/")) {
    const body = await readJson<{
      width?: unknown;
      height?: unknown;
      takenAt?: unknown;
      camera?: unknown;
      durationMs?: unknown;
    }>(ctx.req);
    const validDimension = (value: unknown): value is number | null =>
      value === null || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
    const validTimestamp = (value: unknown): value is number | null =>
      value === null ||
      (typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value > Date.UTC(1980, 0, 1) &&
        value < Date.now() + 86_400_000);
    const validDuration = (value: unknown): value is number | null =>
      value === null || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
    if (
      !body ||
      !validDimension(body.width) ||
      !validDimension(body.height) ||
      !validTimestamp(body.takenAt) ||
      (body.camera !== null &&
        (typeof body.camera !== "string" || body.camera.trim().length === 0 || body.camera.length > 80)) ||
      !validDuration(body.durationMs)
    ) {
      return error("Video metadata is invalid", 400);
    }
    metadata = {
      width: body.width,
      height: body.height,
      takenAt: body.takenAt,
      camera: typeof body.camera === "string" ? body.camera.trim() : null,
      durationMs: body.durationMs,
    };
  } else {
    return error("Metadata can only be processed for images and videos", 415);
  }

  const updated = await updateImageMetadata(ctx.env.DB, image.id, metadata, Date.now());
  if (!updated) return error("Media item not found", 404);
  const result = await getImage(ctx.env.DB, image.id);
  if (!result) return error("Media item not found", 404);
  return json(result);
}

/** PATCH /api/images/:id — update caption (doubles as alt text). */
async function patch(ctx: Ctx): Promise<Response> {
  const body = await readJson<{ caption?: unknown; takenAt?: unknown }>(ctx.req);
  if (!body || (!("caption" in body) && !("takenAt" in body))) {
    return error("caption or takenAt is required", 400);
  }
  if ("caption" in body && body.caption !== null && typeof body.caption !== "string") {
    return error("caption must be a string or null", 400);
  }
  let takenAt: number | null = null;
  const updatesCaptureDate = "takenAt" in body;
  if (updatesCaptureDate) {
    const value = body.takenAt;
    if (value === null) {
      takenAt = null;
    } else if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value > Date.UTC(1980, 0, 1) &&
      value < Date.now() + 86_400_000
    ) {
      takenAt = value;
    } else {
      return error("takenAt must be a valid capture timestamp or null", 400);
    }
  }
  let updated = false;
  const now = Date.now();
  if ("caption" in body) {
    const caption =
      typeof body.caption === "string" ? body.caption.trim().slice(0, 500) : null;
    updated =
      (await updateImageCaption(
        ctx.env.DB,
        ctx.params.id,
        caption && caption.length > 0 ? caption : null,
        now,
      )) || updated;
  }
  if (updatesCaptureDate) {
    updated =
      (await updateImageCaptureDate(
        ctx.env.DB,
        ctx.params.id,
        takenAt,
        now,
      )) || updated;
  }
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
