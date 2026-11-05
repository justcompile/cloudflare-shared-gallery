import { useSyncExternalStore } from "react";
import { ApiError, uploadMedia } from "./api";
import { emit } from "./events";
import { MAX_UPLOAD_BYTES } from "../../shared/upload";

/**
 * App-wide upload queue. Both the upload buttons and the page-wide drop zone
 * feed files in here, so dropping hundreds of media files at once is safe:
 * uploads run at most CONCURRENCY at a time, progress re-renders are
 * throttled, and gallery refresh events are debounced instead of firing once
 * per completed file.
 *
 * Transient failures (network drops, 429s, 5xx from the platform) retry
 * automatically with exponential backoff. Only permanent failures (bad file
 * type, too large) or files that exhausted their retries surface in the tray.
 *
 * Each enqueue call is a batch: the returned promise resolves with the
 * uploaded image ids once every file in that batch has settled, which powers
 * the "add these photos to a collection" prompt.
 */

export interface QueueItem {
  key: string;
  name: string;
  /** 0..1 */
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
}

interface InternalItem extends QueueItem {
  file: File;
  batchId: string;
  attempts: number;
  /** Epoch ms before which a retry must not start. */
  nextAttemptAt: number;
  imageId?: string;
}

export interface UploadBatch {
  batchId: string;
  count: number;
  /** Resolves with the ids of successfully uploaded images once the batch settles. */
  settled: Promise<string[]>;
}

const CONCURRENCY = 3;
const MAX_ATTEMPTS = 4; // 1 initial try + 3 automatic retries
let items: InternalItem[] = [];
let active = 0;
let snapshot: QueueItem[] = [];
let snapshotDirty = true;
const listeners = new Set<() => void>();

interface BatchState {
  remaining: number;
  imageIds: string[];
  resolve: (ids: string[]) => void;
}
const batches = new Map<string, BatchState>();

function notify(): void {
  snapshotDirty = true;
  for (const l of listeners) l();
}

/* Progress events arrive per-chunk per-file; cap re-renders at ~10/s. */
let progressTimer: ReturnType<typeof setTimeout> | null = null;
function notifyProgressThrottled(): void {
  if (progressTimer) return;
  progressTimer = setTimeout(() => {
    progressTimer = null;
    notify();
  }, 100);
}

/* Feeds refresh on "images-changed"; debounce so a 300-file drop does not
   trigger 300 refetches. Fires at most every 2s while uploading, plus once
   immediately when the queue drains. */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleImagesChanged(): void {
  const drained = !items.some((i) => i.status === "queued" || i.status === "uploading");
  if (drained) {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    emit("images-changed");
    return;
  }
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    emit("images-changed");
  }, 2000);
}

/** One terminal event per item lifecycle: settles its batch bookkeeping. */
function markSettled(item: InternalItem): void {
  const batch = batches.get(item.batchId);
  if (!batch) return;
  if (item.status === "done" && item.imageId) batch.imageIds.push(item.imageId);
  batch.remaining--;
  if (batch.remaining <= 0) {
    batch.resolve(batch.imageIds);
    batches.delete(item.batchId);
  }
}

function isRetryable(err: unknown): boolean {
  if (!navigator.onLine) return true; // will retry once the connection returns
  if (err instanceof ApiError) {
    return err.status === 0 || err.status === 429 || err.status >= 500;
  }
  return false;
}

function backoffMs(attempts: number): number {
  return Math.min(15_000, 1_500 * 3 ** (attempts - 1)) + Math.random() * 500;
}

let pumpTimer: ReturnType<typeof setTimeout> | null = null;

function pump(): void {
  const now = Date.now();
  while (active < CONCURRENCY) {
    const next = items.find((i) => i.status === "queued" && i.nextAttemptAt <= now);
    if (!next) break;
    next.status = "uploading";
    active++;
    uploadMedia(next.file, (fraction) => {
      next.progress = fraction;
      notifyProgressThrottled();
    })
      .then((image) => {
        next.status = "done";
        next.progress = 1;
        next.imageId = image.id;
        markSettled(next);
        scheduleImagesChanged();
      })
      .catch((err: unknown) => {
        next.attempts++;
        if (isRetryable(err) && next.attempts < MAX_ATTEMPTS) {
          // Transient failure: back off and try again automatically.
          next.status = "queued";
          next.progress = 0;
          next.nextAttemptAt = Date.now() + backoffMs(next.attempts);
        } else {
          next.status = "error";
          next.error = !navigator.onLine
            ? "You're offline. Uploads resume when you retry with a connection"
            : err instanceof Error
              ? err.message
              : "Upload failed";
          markSettled(next);
        }
      })
      .finally(() => {
        active--;
        notify();
        pump();
      });
  }

  // Wake up again when the earliest backed-off retry becomes eligible.
  const waiting = items.filter((i) => i.status === "queued" && i.nextAttemptAt > now);
  if (waiting.length > 0 && !pumpTimer) {
    const wakeAt = Math.min(...waiting.map((i) => i.nextAttemptAt));
    pumpTimer = setTimeout(
      () => {
        pumpTimer = null;
        pump();
      },
      Math.max(50, wakeAt - Date.now()),
    );
  }
  notify();
}

/** Adds media files to the queue as one batch and starts uploading. */
export function enqueueUploads(files: File[]): UploadBatch {
  const batchId = crypto.randomUUID();
  let resolve!: (ids: string[]) => void;
  const settled = new Promise<string[]>((r) => {
    resolve = r;
  });
  const batch: BatchState = { remaining: files.length, imageIds: [], resolve };
  batches.set(batchId, batch);

  for (const file of files) {
    const item: InternalItem = {
      key: crypto.randomUUID(),
      name: file.name,
      file,
      batchId,
      attempts: 0,
      nextAttemptAt: 0,
      progress: 0,
      status: "queued",
    };
    if (file.size > MAX_UPLOAD_BYTES) {
      item.status = "error";
      item.error = "Larger than the 200 MiB limit";
      items.push(item);
      markSettled(item);
      continue;
    }
    items.push(item);
  }
  if (batch.remaining <= 0 && batches.has(batchId)) {
    // Every file was rejected up front.
    batch.resolve([]);
    batches.delete(batchId);
  }
  pump();
  return { batchId, count: files.length, settled };
}

/** Re-queues failed items for a manual retry (per file or all). */
export function retryFailed(key?: string): void {
  for (const item of items) {
    if (item.status !== "error") continue;
    if (key && item.key !== key) continue;
    if (item.file.size > MAX_UPLOAD_BYTES) continue; // permanently too big
    item.status = "queued";
    item.progress = 0;
    item.attempts = 0;
    item.nextAttemptAt = 0;
    item.error = undefined;
  }
  pump();
}

/** Drops finished (done) items; keeps failures until dismissed. */
export function clearCompleted(): void {
  items = items.filter((i) => i.status !== "done");
  notify();
}

/** Dismisses one failed item, or the whole tray when everything is settled. */
export function dismiss(key?: string): void {
  items = key
    ? items.filter((i) => i.key !== key)
    : items.filter((i) => i.status === "queued" || i.status === "uploading");
  notify();
}

function getSnapshot(): QueueItem[] {
  if (snapshotDirty) {
    snapshot = items.map(({ file: _file, batchId: _b, attempts: _a, nextAttemptAt: _n, imageId: _i, ...rest }) => ({
      ...rest,
    }));
    snapshotDirty = false;
  }
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Live queue contents for the tray UI. */
export function useUploadQueue(): QueueItem[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}
