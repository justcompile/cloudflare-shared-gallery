import type {
  ApiCollection,
  ApiImage,
  ApiImageMembership,
  ImageFilter,
  ImageSort,
  Paginated,
} from "../../shared/types";

/** Raw D1 row shapes (snake_case, as stored). */
interface ImageRow {
  id: string;
  r2_key: string;
  thumbnail_key: string | null;
  original_name: string;
  content_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  caption: string | null;
  uploaded_by: string | null;
  taken_at: number | null;
  camera: string | null;
  deleted_at: number | null;
  deleted_by: string | null;
  created_at: number;
  updated_at: number;
}

interface CollectionRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  cover_image_id: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

type CollectionListRow = CollectionRow & {
  member_count: number;
  effective_cover_id: string | null;
};

export interface UploadSession {
  id: string;
  r2Key: string;
  r2UploadId: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
}

interface UploadSessionRow {
  id: string;
  r2_key: string;
  r2_upload_id: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string;
}

function rowToUploadSession(row: UploadSessionRow): UploadSession {
  return {
    id: row.id,
    r2Key: row.r2_key,
    r2UploadId: row.r2_upload_id,
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedBy: row.uploaded_by,
  };
}

export function rowToImage(row: ImageRow): ApiImage {
  return {
    id: row.id,
    mediaKey: row.r2_key,
    thumbnailKey: row.thumbnail_key,
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    caption: row.caption,
    uploadedBy: row.uploaded_by,
    takenAt: row.taken_at,
    camera: row.camera,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCollection(row: CollectionListRow, cover: ApiImage | null): ApiCollection {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    coverImageId: row.cover_image_id,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: row.member_count,
    cover,
  };
}

/* ------------------------------ pagination ------------------------------ */

interface CursorPayload {
  s: ImageSort;
  n: number; // null-rank of the last item
  v: number | string; // sort value of the last item
  i: string; // id of the last item (tiebreak)
}

export function encodeCursor(payload: CursorPayload): string {
  return btoa(JSON.stringify(payload)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const b64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const parsed = JSON.parse(atob(b64)) as CursorPayload;
    if (
      typeof parsed.s !== "string" ||
      typeof parsed.n !== "number" ||
      (typeof parsed.v !== "number" && typeof parsed.v !== "string") ||
      typeof parsed.i !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clampLimit(raw: string | null, fallback = 60, max = 120): number {
  const n = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/* -------------------------------- images -------------------------------- */

export interface NewImage {
  id: string;
  r2Key: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  uploadedBy: string | null;
  takenAt: number | null;
  camera: string | null;
  createdAt: number;
}

export async function insertImage(db: D1Database, img: NewImage): Promise<void> {
  await db
    .prepare(
      `INSERT INTO images (id, r2_key, original_name, content_type, size_bytes, width, height, caption, uploaded_by, taken_at, camera, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .bind(
      img.id,
      img.r2Key,
      img.originalName,
      img.contentType,
      img.sizeBytes,
      img.width,
      img.height,
      img.uploadedBy,
      img.takenAt,
      img.camera,
      img.createdAt,
      img.createdAt,
    )
    .run();
}

export async function insertUploadSession(
  db: D1Database,
  session: UploadSession,
  createdAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO upload_sessions
       (id, r2_key, r2_upload_id, original_name, content_type, size_bytes, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      session.id,
      session.r2Key,
      session.r2UploadId,
      session.originalName,
      session.contentType,
      session.sizeBytes,
      session.uploadedBy,
      createdAt,
    )
    .run();
}

export async function getUploadSession(db: D1Database, id: string): Promise<UploadSession | null> {
  const row = await db
    .prepare("SELECT * FROM upload_sessions WHERE id = ?")
    .bind(id)
    .first<UploadSessionRow>();
  return row ? rowToUploadSession(row) : null;
}

export async function deleteUploadSession(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM upload_sessions WHERE id = ?").bind(id).run();
}

export async function getImage(db: D1Database, id: string): Promise<ApiImage | null> {
  const row = await db
    .prepare(`SELECT * FROM images WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<ImageRow>();
  return row ? rowToImage(row) : null;
}

export async function updateVideoThumbnail(
  db: D1Database,
  id: string,
  thumbnailKey: string,
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE images
       SET thumbnail_key = ?, updated_at = ?
       WHERE id = ? AND content_type LIKE 'video/%' AND deleted_at IS NULL`,
    )
    .bind(thumbnailKey, now, id)
    .run();
  return res.meta.changes > 0;
}

export async function updateImageMetadata(
  db: D1Database,
  id: string,
  metadata: {
    width: number | null;
    height: number | null;
    takenAt: number | null;
    camera: string | null;
    durationMs: number | null;
  },
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE images
       SET width = ?, height = ?, taken_at = ?, camera = ?, duration_ms = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(
      metadata.width,
      metadata.height,
      metadata.takenAt,
      metadata.camera,
      metadata.durationMs,
      now,
      id,
    )
    .run();
  return res.meta.changes > 0;
}

export async function getImageByKey(db: D1Database, r2Key: string): Promise<ApiImage | null> {
  const row = await db
    .prepare(`SELECT * FROM images WHERE r2_key = ?`)
    .bind(r2Key)
    .first<ImageRow>();
  return row ? rowToImage(row) : null;
}

export async function listImages(
  db: D1Database,
  opts: {
    filter: ImageFilter;
    cursor: string | null;
    limit: number;
    /** Restrict to photos uploaded by this display name. */
    uploader?: string | null;
    sort: ImageSort;
  },
): Promise<Paginated<ApiImage>> {
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
  const after = decoded?.s === opts.sort ? decoded : null;
  const sort = imageSortSql(opts.sort);
  const join =
    opts.filter === "untagged" ? `LEFT JOIN image_collections ic ON ic.image_id = i.id` : "";
  const where: string[] = [`i.deleted_at IS NULL`];
  const binds: unknown[] = [];
  if (opts.filter === "untagged") where.push(`ic.image_id IS NULL`);
  if (opts.uploader) {
    where.push(`i.uploaded_by = ?`);
    binds.push(opts.uploader);
  }
  if (after) {
    where.push(
      `(${sort.nullRank} > ? OR (${sort.nullRank} = ? AND (${sort.value} ${sort.comparison} ? OR (${sort.value} = ? AND i.id ${sort.comparison} ?))))`,
    );
    binds.push(after.n, after.n, after.v, after.v, after.i);
  }
  binds.push(opts.limit + 1);

  const sql = `SELECT i.* FROM images i ${join}
     WHERE ${where.join(" AND ")}
     ORDER BY ${sort.nullRank} ASC, ${sort.value} ${sort.direction}, i.id ${sort.direction}
     LIMIT ?`;
  const { results } = await db.prepare(sql).bind(...binds).all<ImageRow>();
  return paginate(results, opts.limit, opts.sort);
}

function imageSortSql(sort: ImageSort): {
  nullRank: string;
  value: string;
  direction: "ASC" | "DESC";
  comparison: ">" | "<";
} {
  switch (sort) {
    case "newest":
      return {
        nullRank: "CASE WHEN i.id IS NULL THEN 1 ELSE 0 END",
        value: "i.created_at",
        direction: "DESC",
        comparison: "<",
      };
    case "oldest":
      return {
        nullRank: "CASE WHEN i.id IS NULL THEN 1 ELSE 0 END",
        value: "i.created_at",
        direction: "ASC",
        comparison: ">",
      };
    case "capture-newest":
      return {
        nullRank: "CASE WHEN i.taken_at IS NULL THEN 1 ELSE 0 END",
        value: "COALESCE(i.taken_at, 0)",
        direction: "DESC",
        comparison: "<",
      };
    case "capture-oldest":
      return {
        nullRank: "CASE WHEN i.taken_at IS NULL THEN 1 ELSE 0 END",
        value: "COALESCE(i.taken_at, 0)",
        direction: "ASC",
        comparison: ">",
      };
    case "filename-asc":
      return {
        nullRank: "CASE WHEN i.id IS NULL THEN 1 ELSE 0 END",
        value: "i.original_name COLLATE NOCASE",
        direction: "ASC",
        comparison: ">",
      };
    case "filename-desc":
      return {
        nullRank: "CASE WHEN i.id IS NULL THEN 1 ELSE 0 END",
        value: "i.original_name COLLATE NOCASE",
        direction: "DESC",
        comparison: "<",
      };
    case "size-desc":
      return {
        nullRank: "CASE WHEN i.id IS NULL THEN 1 ELSE 0 END",
        value: "i.size_bytes",
        direction: "DESC",
        comparison: "<",
      };
    case "size-asc":
      return {
        nullRank: "CASE WHEN i.id IS NULL THEN 1 ELSE 0 END",
        value: "i.size_bytes",
        direction: "ASC",
        comparison: ">",
      };
    case "uploader-asc":
      return {
        nullRank: "CASE WHEN i.id IS NULL THEN 1 ELSE 0 END",
        value: "COALESCE(i.uploaded_by, '') COLLATE NOCASE",
        direction: "ASC",
        comparison: ">",
      };
    case "uploader-desc":
      return {
        nullRank: "CASE WHEN i.id IS NULL THEN 1 ELSE 0 END",
        value: "COALESCE(i.uploaded_by, '') COLLATE NOCASE",
        direction: "DESC",
        comparison: "<",
      };
  }
}

function rowSortValue(row: ImageRow, sort: ImageSort): number | string {
  switch (sort) {
    case "newest":
    case "oldest":
      return row.created_at;
    case "capture-newest":
    case "capture-oldest":
      return row.taken_at ?? 0;
    case "filename-asc":
    case "filename-desc":
      return row.original_name;
    case "size-desc":
    case "size-asc":
      return row.size_bytes;
    case "uploader-asc":
    case "uploader-desc":
      return row.uploaded_by ?? "";
  }
}

function paginate(rows: ImageRow[], limit: number, sort: ImageSort): Paginated<ApiImage> {
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(rowToImage),
    cursor:
      hasMore && last
        ? encodeCursor({
            s: sort,
            n: sort.startsWith("capture-") && last.taken_at === null ? 1 : 0,
            v: rowSortValue(last, sort),
            i: last.id,
          })
        : null,
  };
}

export async function updateImageCaption(
  db: D1Database,
  id: string,
  caption: string | null,
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE images SET caption = ?, updated_at = ? WHERE id = ?`)
    .bind(caption, now, id)
    .run();
  return res.meta.changes > 0;
}

export async function updateImageCaptureDate(
  db: D1Database,
  id: string,
  takenAt: number | null,
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE images SET taken_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .bind(takenAt, now, id)
    .run();
  return res.meta.changes > 0;
}

/** How long soft-deleted photos stay recoverable before the lazy purge. */
export const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Soft delete: marks the row and keeps both the R2 object and the junction
 * rows, so a restore brings memberships back too. Nothing is destroyed here.
 */
export async function softDeleteImage(
  db: D1Database,
  id: string,
  deletedBy: string | null,
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE images SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(now, deletedBy, now, id)
    .run();
  return res.meta.changes > 0;
}

export async function softDeleteImages(
  db: D1Database,
  ids: string[],
  deletedBy: string | null,
  now: number,
): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const res = await db
    .prepare(
      `UPDATE images
       SET deleted_at = ?, deleted_by = ?, updated_at = ?
       WHERE deleted_at IS NULL AND id IN (${placeholders})`,
    )
    .bind(now, deletedBy, now, ...ids)
    .run();
  return res.meta.changes;
}

export async function restoreImage(db: D1Database, id: string, now: number): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE images SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`,
    )
    .bind(now, id)
    .run();
  return res.meta.changes > 0;
}

export async function listDeletedImages(db: D1Database): Promise<ApiImage[]> {
  const { results } = await db
    .prepare(`SELECT * FROM images WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500`)
    .all<ImageRow>();
  return results.map(rowToImage);
}

/**
 * Permanently removes photos whose recovery window has passed: R2 objects
 * first (one bulk call), then the rows (junction rows cascade). Called
 * opportunistically via waitUntil; the only hard-delete path in the app.
 */
export async function purgeExpiredDeletions(db: D1Database, bucket: R2Bucket, now: number): Promise<number> {
  const cutoff = now - PURGE_AFTER_MS;
  const { results } = await db
    .prepare(
      `SELECT id, r2_key, thumbnail_key FROM images
       WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 50`,
    )
    .bind(cutoff)
    .all<{ id: string; r2_key: string; thumbnail_key: string | null }>();
  if (results.length === 0) return 0;
  await bucket.delete(
    results.flatMap((r) => (r.thumbnail_key ? [r.r2_key, r.thumbnail_key] : [r.r2_key])),
  );
  const placeholders = results.map(() => "?").join(", ");
  await db
    .prepare(`DELETE FROM images WHERE id IN (${placeholders})`)
    .bind(...results.map((r) => r.id))
    .run();
  return results.length;
}

export async function getImageMemberships(
  db: D1Database,
  imageId: string,
): Promise<ApiImageMembership[]> {
  const { results } = await db
    .prepare(
      `SELECT ic.collection_id, c.name, c.slug, ic.added_by, ic.added_at
       FROM image_collections ic
       JOIN collections c ON c.id = ic.collection_id
       WHERE ic.image_id = ?
       ORDER BY c.sort_order ASC, c.name ASC`,
    )
    .bind(imageId)
    .all<{
      collection_id: string;
      name: string;
      slug: string;
      added_by: string | null;
      added_at: number;
    }>();
  return results.map((r) => ({
    collectionId: r.collection_id,
    name: r.name,
    slug: r.slug,
    addedBy: r.added_by,
    addedAt: r.added_at,
  }));
}

/* ------------------------------ collections ----------------------------- */

const COLLECTION_LIST_SQL = `
  SELECT c.*,
    (SELECT COUNT(*) FROM image_collections ic
     JOIN images i ON i.id = ic.image_id AND i.deleted_at IS NULL
     WHERE ic.collection_id = c.id) AS member_count,
    COALESCE(
      (SELECT c.cover_image_id FROM images ci
       WHERE ci.id = c.cover_image_id AND ci.deleted_at IS NULL),
      (SELECT ic.image_id FROM image_collections ic
       JOIN images i ON i.id = ic.image_id AND i.deleted_at IS NULL
       WHERE ic.collection_id = c.id
       ORDER BY ic.added_at DESC LIMIT 1)
    ) AS effective_cover_id
  FROM collections c`;

async function attachCovers(
  db: D1Database,
  rows: CollectionListRow[],
): Promise<ApiCollection[]> {
  const coverIds = [...new Set(rows.map((r) => r.effective_cover_id).filter((x): x is string => !!x))];
  const covers = new Map<string, ApiImage>();
  if (coverIds.length > 0) {
    const placeholders = coverIds.map(() => "?").join(", ");
    const { results } = await db
      .prepare(`SELECT * FROM images WHERE id IN (${placeholders})`)
      .bind(...coverIds)
      .all<ImageRow>();
    for (const row of results) covers.set(row.id, rowToImage(row));
  }
  return rows.map((r) =>
    rowToCollection(r, r.effective_cover_id ? (covers.get(r.effective_cover_id) ?? null) : null),
  );
}

export async function listCollections(db: D1Database): Promise<ApiCollection[]> {
  const { results } = await db
    .prepare(`${COLLECTION_LIST_SQL} ORDER BY c.sort_order ASC, c.created_at DESC`)
    .all<CollectionListRow>();
  return attachCovers(db, results);
}

export async function getCollection(db: D1Database, id: string): Promise<ApiCollection | null> {
  const row = await db
    .prepare(`${COLLECTION_LIST_SQL} WHERE c.id = ?`)
    .bind(id)
    .first<CollectionListRow>();
  if (!row) return null;
  const [collection] = await attachCovers(db, [row]);
  return collection;
}

export async function getCollectionBySlug(db: D1Database, slug: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS one FROM collections WHERE slug = ?`)
    .bind(slug)
    .first<{ one: number }>();
  return row !== null;
}

export interface NewCollection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdBy: string | null;
  createdAt: number;
}

export async function insertCollection(db: D1Database, c: NewCollection): Promise<void> {
  await db
    .prepare(
      `INSERT INTO collections (id, name, slug, description, cover_image_id, sort_order, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 0, ?, ?, ?)`,
    )
    .bind(c.id, c.name, c.slug, c.description, c.createdBy, c.createdAt, c.createdAt)
    .run();
}

export interface CollectionPatch {
  name?: string;
  description?: string | null;
  coverImageId?: string | null;
  sortOrder?: number;
}

export async function updateCollection(
  db: D1Database,
  id: string,
  patch: CollectionPatch,
  now: number,
): Promise<boolean> {
  const sets: string[] = ["updated_at = ?"];
  const binds: unknown[] = [now];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    binds.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    binds.push(patch.description);
  }
  if (patch.coverImageId !== undefined) {
    sets.push("cover_image_id = ?");
    binds.push(patch.coverImageId);
  }
  if (patch.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    binds.push(patch.sortOrder);
  }
  binds.push(id);
  const res = await db
    .prepare(`UPDATE collections SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  return res.meta.changes > 0;
}

/** Deletes the collection; images survive, membership rows cascade away. */
export async function deleteCollection(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM collections WHERE id = ?`).bind(id).run();
  return res.meta.changes > 0;
}

export async function listCollectionImages(
  db: D1Database,
  collectionId: string,
  opts: { cursor: string | null; limit: number; sort: ImageSort },
): Promise<Paginated<ApiImage>> {
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
  const after = decoded?.s === opts.sort ? decoded : null;
  const sort = imageSortSql(opts.sort);
  const cursorWhere = after
    ? `AND (${sort.nullRank} > ? OR (${sort.nullRank} = ? AND (${sort.value} ${sort.comparison} ? OR (${sort.value} = ? AND i.id ${sort.comparison} ?))))`
    : "";
  const sql = `SELECT i.* FROM images i
     JOIN image_collections ic ON ic.image_id = i.id
     WHERE ic.collection_id = ?1 AND i.deleted_at IS NULL ${cursorWhere}
     ORDER BY ${sort.nullRank} ASC, ${sort.value} ${sort.direction}, i.id ${sort.direction}
     LIMIT ?`;
  const binds: (string | number)[] = [collectionId];
  if (after) binds.push(after.n, after.n, after.v, after.v, after.i);
  binds.push(opts.limit + 1);
  const stmt = db.prepare(sql).bind(...binds);
  const { results } = await stmt.all<ImageRow>();
  return paginate(results, opts.limit, opts.sort);
}

/** Adds images to a collection, idempotently. Returns how many rows were new. */
export async function addImagesToCollection(
  db: D1Database,
  collectionId: string,
  imageIds: string[],
  addedBy: string | null,
  now: number,
): Promise<number> {
  if (imageIds.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO image_collections (image_id, collection_id, added_by, added_at)
     SELECT id, ?, ?, ? FROM images WHERE id = ?`,
  );
  const results = await db.batch(
    imageIds.map((imageId) => stmt.bind(collectionId, addedBy, now, imageId)),
  );
  return results.reduce((sum, r) => sum + r.meta.changes, 0);
}

export async function removeImageFromCollection(
  db: D1Database,
  collectionId: string,
  imageId: string,
): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM image_collections WHERE collection_id = ? AND image_id = ?`)
    .bind(collectionId, imageId)
    .run();
  return res.meta.changes > 0;
}

/* ----------------------------- login throttle ---------------------------- */

export const THROTTLE_WINDOW_MS = 5 * 60 * 1000;
export const THROTTLE_MAX_FAILURES = 10;

/**
 * Returns true when the IP has exceeded the failure budget inside the window.
 * Opportunistically prunes rows older than the window to keep the table small.
 */
export async function isThrottled(db: D1Database, ip: string, now: number): Promise<boolean> {
  const windowStart = now - THROTTLE_WINDOW_MS;
  await db.prepare(`DELETE FROM login_attempts WHERE attempted_at < ?`).bind(windowStart).run();
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND attempted_at >= ?`)
    .bind(ip, windowStart)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= THROTTLE_MAX_FAILURES;
}

export async function recordLoginFailure(db: D1Database, ip: string, now: number): Promise<void> {
  await db
    .prepare(`INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)`)
    .bind(ip, now)
    .run();
}

export async function clearLoginFailures(db: D1Database, ip: string): Promise<void> {
  await db.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(ip).run();
}
