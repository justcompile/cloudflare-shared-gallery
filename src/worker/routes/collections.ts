import type { Ctx, Router } from "../router";
import { error, json, noContent, readJson } from "../lib/json";
import {
  addImagesToCollection,
  clampLimit,
  listCollections,
  deleteCollection,
  getCollection,
  getCollectionBySlug,
  getImage,
  insertCollection,
  listCollectionImages,
  removeImageFromCollection,
  updateCollection,
} from "../db/queries";
import { isImageSort, type ApiCollectionDetail } from "../../shared/types";

export function registerCollectionRoutes(router: Router): void {
  router.get("/api/collections", list);
  router.post("/api/collections", create);
  router.get("/api/collections/:id", detail);
  router.patch("/api/collections/:id", patch);
  router.delete("/api/collections/:id", remove);
  router.post("/api/collections/:id/images", addImages);
  router.delete("/api/collections/:id/images/:imageId", removeImage);
}

async function list(ctx: Ctx): Promise<Response> {
  return json(await listCollections(ctx.env.DB));
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "collection";
}

/** De-duplicates the slug by appending -2, -3, … until free. */
async function uniqueSlug(db: D1Database, base: string): Promise<string> {
  if (!(await getCollectionBySlug(db, base))) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!(await getCollectionBySlug(db, candidate))) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function create(ctx: Ctx): Promise<Response> {
  if (!ctx.displayName) return error("Set a display name before creating collections", 400);
  const body = await readJson<{ name?: unknown; description?: unknown }>(ctx.req);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (name.length === 0) return error("Collection name is required", 400);
  const description =
    typeof body?.description === "string" && body.description.trim().length > 0
      ? body.description.trim().slice(0, 500)
      : null;

  const id = crypto.randomUUID();
  const slug = await uniqueSlug(ctx.env.DB, slugify(name));
  await insertCollection(ctx.env.DB, {
    id,
    name,
    slug,
    description,
    createdBy: ctx.displayName,
    createdAt: Date.now(),
  });
  return json(await getCollection(ctx.env.DB, id), 201);
}

/** GET /api/collections/:id?cursor=&limit= — collection plus its images. */
async function detail(ctx: Ctx): Promise<Response> {
  const collection = await getCollection(ctx.env.DB, ctx.params.id);
  if (!collection) return error("Collection not found", 404);
  const sortRaw = ctx.url.searchParams.get("sort") ?? "newest";
  if (!isImageSort(sortRaw)) {
    return error("sort is not supported", 400);
  }
  const page = await listCollectionImages(ctx.env.DB, collection.id, {
    cursor: ctx.url.searchParams.get("cursor"),
    limit: clampLimit(ctx.url.searchParams.get("limit")),
    sort: sortRaw,
  });
  const body: ApiCollectionDetail = { ...collection, images: page.items, cursor: page.cursor };
  return json(body);
}

async function patch(ctx: Ctx): Promise<Response> {
  const body = await readJson<{
    name?: unknown;
    description?: unknown;
    coverImageId?: unknown;
    sortOrder?: unknown;
  }>(ctx.req);
  if (!body) return error("Invalid JSON body", 400);

  const patchData: Parameters<typeof updateCollection>[2] = {};
  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    if (name.length === 0) return error("Collection name cannot be empty", 400);
    patchData.name = name;
  }
  if ("description" in body) {
    if (body.description !== null && typeof body.description !== "string") {
      return error("description must be a string or null", 400);
    }
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : null;
    patchData.description = description && description.length > 0 ? description : null;
  }
  if ("coverImageId" in body) {
    if (body.coverImageId !== null && typeof body.coverImageId !== "string") {
      return error("coverImageId must be an image id or null", 400);
    }
    if (typeof body.coverImageId === "string") {
      const image = await getImage(ctx.env.DB, body.coverImageId);
      if (!image) return error("Cover image not found", 404);
    }
    patchData.coverImageId = body.coverImageId as string | null;
  }
  if ("sortOrder" in body) {
    if (typeof body.sortOrder !== "number" || !Number.isFinite(body.sortOrder)) {
      return error("sortOrder must be a number", 400);
    }
    patchData.sortOrder = Math.trunc(body.sortOrder);
  }
  if (Object.keys(patchData).length === 0) return error("Nothing to update", 400);

  const updated = await updateCollection(ctx.env.DB, ctx.params.id, patchData, Date.now());
  if (!updated) return error("Collection not found", 404);
  return json(await getCollection(ctx.env.DB, ctx.params.id));
}

/** DELETE /api/collections/:id — images survive; membership rows cascade. */
async function remove(ctx: Ctx): Promise<Response> {
  const deleted = await deleteCollection(ctx.env.DB, ctx.params.id);
  if (!deleted) return error("Collection not found", 404);
  return noContent();
}

/** POST /api/collections/:id/images — body { imageIds: string[] }. Idempotent. */
async function addImages(ctx: Ctx): Promise<Response> {
  if (!ctx.displayName) return error("Set a display name before tagging", 400);
  const body = await readJson<{ imageIds?: unknown }>(ctx.req);
  const ids = body?.imageIds;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
    return error("imageIds must be an array of image ids", 400);
  }
  if (ids.length === 0) return json({ added: 0 });
  if (ids.length > 200) return error("At most 200 images per request", 400);

  const collection = await getCollection(ctx.env.DB, ctx.params.id);
  if (!collection) return error("Collection not found", 404);

  const added = await addImagesToCollection(
    ctx.env.DB,
    collection.id,
    ids as string[],
    ctx.displayName,
    Date.now(),
  );
  return json({ added });
}

async function removeImage(ctx: Ctx): Promise<Response> {
  const removed = await removeImageFromCollection(ctx.env.DB, ctx.params.id, ctx.params.imageId);
  if (!removed) return error("Image is not in this collection", 404);
  return noContent();
}
