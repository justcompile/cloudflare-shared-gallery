import type { Ctx, Router } from "../router";
import { error } from "../lib/json";

/**
 * Gated media byte serving.
 *
 *   GET /media/:key           — stream the original from R2 (full-res download)
 *   GET /media/:key?v=thumb   — 480w variant  (grid tiles)
 *   GET /media/:key?v=full    — 1600w variant (lightbox)
 *
 * Variants transform through the Images binding (Cloudflare's image
 * pipeline, not Worker CPU) and are cached in the Cache API with a long
 * immutable TTL. The cache check runs AFTER the session gate, and caching
 * stays inside the Worker on purpose: platform-level response caching would
 * serve gated bytes without running the Worker at all.
 *
 * The Cache API layer is what keeps repeat views from re-counting against
 * the 5,000 unique transformations / 30 days Free allowance.
 */

const VARIANTS = {
  thumb: { width: 480, quality: 78 },
  full: { width: 1600, quality: 85 },
} as const;

type VariantName = keyof typeof VARIANTS;

export function registerMediaRoutes(router: Router): void {
  router.get("/media/:key", serve);
}

async function serve(ctx: Ctx): Promise<Response> {
  const key = ctx.params.key;
  const variantRaw = ctx.url.searchParams.get("v");
  if (variantRaw === null) return serveOriginal(ctx, key);
  if (variantRaw !== "thumb" && variantRaw !== "full") {
    return error("Unknown variant; use v=thumb or v=full", 400);
  }
  return serveVariant(ctx, key, variantRaw);
}

async function serveOriginal(ctx: Ctx, key: string): Promise<Response> {
  const rangeHeader = ctx.req.headers.get("Range");
  if (!rangeHeader) {
    const obj = await ctx.env.BUCKET.get(key);
    if (!obj) return error("Not found", 404);
    const headers = originalHeaders(obj);
    return new Response(obj.body, { headers });
  }

  const head = await ctx.env.BUCKET.head(key);
  if (!head) return error("Not found", 404);
  const range = parseRange(rangeHeader, head.size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${head.size}`, "Accept-Ranges": "bytes" },
    });
  }
  const obj = await ctx.env.BUCKET.get(key, { range });
  if (!obj) return error("Not found", 404);
  const end = range.offset + range.length - 1;
  const headers = originalHeaders(obj);
  headers.set("Content-Range", `bytes ${range.offset}-${end}/${head.size}`);
  headers.set("Content-Length", String(range.length));
  return new Response(obj.body, { status: 206, headers });
}

function originalHeaders(obj: R2ObjectBody): Headers {
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  return headers;
}

function parseRange(
  value: string,
  size: number,
): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : null;
  const requestedEnd = match[2] ? Number(match[2]) : null;
  if (start === null && requestedEnd === null) return null;
  if (start === null) {
    if (requestedEnd === null || requestedEnd <= 0) return null;
    const length = Math.min(requestedEnd, size);
    return { offset: size - length, length };
  }
  if (start >= size) return null;
  if (requestedEnd !== null && requestedEnd < start) return null;
  const end = requestedEnd === null ? size - 1 : Math.min(requestedEnd, size - 1);
  return {
    offset: start,
    length: end - start + 1,
  };
}

/**
 * `format=auto` semantics, negotiated from the Accept header since the
 * binding requires an explicit output format. The chosen format is part of
 * the cache key so AVIF-capable and legacy browsers never share entries.
 */
function negotiateFormat(accept: string | null): {
  mime: "image/avif" | "image/webp" | "image/jpeg";
  label: string;
} {
  const a = accept ?? "";
  if (a.includes("image/avif")) return { mime: "image/avif", label: "avif" };
  if (a.includes("image/webp")) return { mime: "image/webp", label: "webp" };
  return { mime: "image/jpeg", label: "jpeg" };
}

async function serveVariant(ctx: Ctx, key: string, variant: VariantName): Promise<Response> {
  const format = negotiateFormat(ctx.req.headers.get("Accept"));

  // Normalized cache key: key + variant + negotiated format, nothing else.
  const cacheUrl = new URL(ctx.url.origin);
  cacheUrl.pathname = `/media/${encodeURIComponent(key)}`;
  cacheUrl.searchParams.set("v", variant);
  cacheUrl.searchParams.set("f", format.label);
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const hit = new Response(cached.body, cached);
    hit.headers.set("X-Gallery-Cache", "hit");
    return hit;
  }

  const obj = await ctx.env.BUCKET.get(key);
  if (!obj) return error("Not found", 404);
  if (obj.httpMetadata?.contentType?.startsWith("video/")) {
    return error("Video files do not have image variants", 415);
  }

  const preset = VARIANTS[variant];
  try {
    // Stream R2 → Images pipeline; the original is never buffered in memory.
    const transformed = await ctx.env.IMAGES.input(obj.body)
      .transform({ width: preset.width, fit: "scale-down" })
      .output({ format: format.mime, quality: preset.quality });

    const upstream = transformed.response();
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("Vary", "Accept");
    headers.set("X-Gallery-Cache", "miss");
    const response = new Response(upstream.body, { status: 200, headers });

    // Store before returning so the next request never re-transforms.
    ctx.exec.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    // Transform can fail for originals past the binding's 20 MB input limit
    // or exotic payloads; degrade to the original bytes rather than a broken
    // tile. (obj.body may be locked after a failed transform — re-fetch.)
    console.warn("Variant transform failed; serving original", { key, variant, err });
    return serveOriginal(ctx, key);
  }
}
