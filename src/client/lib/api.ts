import type {
  ApiCollection,
  ApiCollectionDetail,
  ApiImage,
  ApiImageDetail,
  ApiStats,
  ApiUpdates,
  ImageFilter,
  ImageSort,
  Paginated,
} from "../../shared/types";
import { getStoredDisplayName } from "./user";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Registered by the app shell; fired when any gated call returns 401. */
let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

function userHeader(): Record<string, string> {
  const name = getStoredDisplayName();
  // Percent-encode so non-ASCII names survive the header; server decodes.
  return name ? { "X-Gallery-User": encodeURIComponent(name) } : {};
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...userHeader(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    unauthorizedHandler?.();
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Non-JSON error body; keep the fallback message.
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* --------------------------------- auth --------------------------------- */

export function login(password: string): Promise<void> {
  return request("POST", "/api/auth/login", { password });
}

export function logout(): Promise<void> {
  return request("POST", "/api/auth/logout");
}

/** Returns true when the cookie holds a valid session. */
export async function checkSession(): Promise<boolean> {
  try {
    await request("GET", "/api/auth/session");
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return false;
    throw err;
  }
}

/* -------------------------------- images -------------------------------- */

export function listImages(opts: {
  filter?: ImageFilter;
  cursor?: string | null;
  limit?: number;
  uploader?: string;
  sort?: ImageSort;
}): Promise<Paginated<ApiImage>> {
  const params = new URLSearchParams();
  params.set("filter", opts.filter ?? "all");
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.uploader) params.set("uploader", opts.uploader);
  if (opts.sort) params.set("sort", opts.sort);
  return request("GET", `/api/images?${params}`);
}

export function getStats(): Promise<ApiStats> {
  return request("GET", "/api/stats");
}

export function getUpdates(since: number): Promise<ApiUpdates> {
  return request("GET", `/api/updates?since=${since}`);
}

export function getImage(id: string): Promise<ApiImageDetail> {
  return request("GET", `/api/images/${encodeURIComponent(id)}`);
}

export function updateCaption(id: string, caption: string | null): Promise<ApiImageDetail> {
  return request("PATCH", `/api/images/${encodeURIComponent(id)}`, { caption });
}

export function updateCaptureDate(id: string, takenAt: number | null): Promise<ApiImageDetail> {
  return request("PATCH", `/api/images/${encodeURIComponent(id)}`, { takenAt });
}

export function reprocessImageMetadata(id: string): Promise<ApiImage> {
  return request("POST", `/api/images/${encodeURIComponent(id)}/reprocess-metadata`);
}

export function saveVideoMetadata(
  id: string,
  metadata: {
    width: number | null;
    height: number | null;
    takenAt: number | null;
    camera: string | null;
    durationMs: number | null;
  },
): Promise<ApiImage> {
  return request("POST", `/api/images/${encodeURIComponent(id)}/reprocess-metadata`, metadata);
}

export async function uploadVideoThumbnail(id: string, thumbnail: Blob): Promise<ApiImage> {
  const path = `/api/images/${encodeURIComponent(id)}/thumbnail`;
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "image/jpeg",
      ...userHeader(),
    },
    body: thumbnail,
  });

  if (res.status === 401) unauthorizedHandler?.();
  if (!res.ok) {
    let message = `Thumbnail upload failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Non-JSON error body; keep the fallback message.
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as ApiImage;
}

export function deleteImage(id: string): Promise<void> {
  return request("DELETE", `/api/images/${encodeURIComponent(id)}`);
}

export function deleteImages(imageIds: string[]): Promise<{ deleted: number }> {
  return request("POST", "/api/images/bulk-delete", { imageIds });
}

export function listDeleted(): Promise<ApiImage[]> {
  return request("GET", "/api/images/deleted");
}

export function restoreImage(id: string): Promise<ApiImage> {
  return request("POST", `/api/images/${encodeURIComponent(id)}/restore`);
}

/**
 * Uploads one media file as a streamed body via XHR (fetch has no upload
 * progress). Resolves with the created image record.
 */
export function uploadMedia(
  file: File,
  onProgress: (fraction: number) => void,
): Promise<ApiImage> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/images");
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-Original-Name", encodeURIComponent(file.name));
    const user = userHeader();
    for (const [k, v] of Object.entries(user)) xhr.setRequestHeader(k, v);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 401) unauthorizedHandler?.();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ApiImage);
      } else {
        const message =
          (xhr.response as { error?: string } | null)?.error ?? `Upload failed (${xhr.status})`;
        reject(new ApiError(message, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError("Network error during upload", 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled", 0));
    xhr.send(file);
  });
}

/* ------------------------------ collections ------------------------------ */

export function listCollections(): Promise<ApiCollection[]> {
  return request("GET", "/api/collections");
}

export function createCollection(input: {
  name: string;
  description?: string;
}): Promise<ApiCollection> {
  return request("POST", "/api/collections", input);
}

export function getCollection(
  id: string,
  opts: { cursor?: string | null; limit?: number; sort?: ImageSort } = {},
): Promise<ApiCollectionDetail> {
  const params = new URLSearchParams();
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.sort) params.set("sort", opts.sort);
  const qs = params.size > 0 ? `?${params}` : "";
  return request("GET", `/api/collections/${encodeURIComponent(id)}${qs}`);
}

export function updateCollection(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    coverImageId?: string | null;
    sortOrder?: number;
  },
): Promise<ApiCollection> {
  return request("PATCH", `/api/collections/${encodeURIComponent(id)}`, patch);
}

export function deleteCollection(id: string): Promise<void> {
  return request("DELETE", `/api/collections/${encodeURIComponent(id)}`);
}

export function addImagesToCollection(collectionId: string, imageIds: string[]): Promise<void> {
  return request("POST", `/api/collections/${encodeURIComponent(collectionId)}/images`, {
    imageIds,
  });
}

export function removeImageFromCollection(collectionId: string, imageId: string): Promise<void> {
  return request(
    "DELETE",
    `/api/collections/${encodeURIComponent(collectionId)}/images/${encodeURIComponent(imageId)}`,
  );
}

/* --------------------------------- media --------------------------------- */

export function mediaUrl(mediaKey: string, variant?: "thumb" | "full"): string {
  const base = `/media/${encodeURIComponent(mediaKey)}`;
  return variant ? `${base}?v=${variant}` : base;
}

export async function readMediaRange(
  mediaKey: string,
  offset: number,
  size: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Invalid media byte range");
  }
  const res = await fetch(mediaUrl(mediaKey), {
    credentials: "include",
    headers: { Range: `bytes=${offset}-${offset + size - 1}` },
  });
  if (res.status === 401) unauthorizedHandler?.();
  if (res.status !== 206) {
    throw new ApiError(`Couldn't read media metadata (${res.status})`, res.status);
  }
  const chunk = new Uint8Array(await res.arrayBuffer());
  if (chunk.byteLength !== size) {
    throw new Error("The media returned an incomplete metadata range");
  }
  return chunk;
}

/** srcset spanning both presets so the browser picks per DPR/viewport. */
export function mediaSrcSet(mediaKey: string): string {
  return `${mediaUrl(mediaKey, "thumb")} 480w, ${mediaUrl(mediaKey, "full")} 1600w`;
}
