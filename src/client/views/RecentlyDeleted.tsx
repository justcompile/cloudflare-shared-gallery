import { useCallback, useEffect, useState } from "react";
import type { ApiImage } from "../../shared/types";
import * as api from "../lib/api";
import { emit } from "../lib/events";
import EmptyState from "../components/EmptyState";
import { IconTrash } from "../components/icons";
import VideoPlaceholder from "../components/VideoPlaceholder";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECOVERY_DAYS = 30;

function daysLeft(deletedAt: number): number {
  return Math.max(0, Math.ceil((deletedAt + RECOVERY_DAYS * DAY_MS - Date.now()) / DAY_MS));
}

/** Recently deleted: media waits here 30 days and can be restored by anyone. */
export default function RecentlyDeleted({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<ApiImage[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listDeleted()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Couldn't load recently deleted"),
      );
  }, []);

  useEffect(load, [load]);

  async function restore(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      await api.restoreImage(id);
      setItems((prev) => prev?.filter((i) => i.id !== id) ?? null);
      emit("images-changed");
      emit("collections-changed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't restore the item");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-stone-400">
        <button onClick={onBack} className="min-h-11 rounded-lg px-2 hover:text-stone-200">
          ‹ Home
        </button>
        <span aria-hidden>/</span>
        <span className="px-1 text-stone-200">Recently deleted</span>
      </nav>

      <p className="max-w-prose text-sm text-stone-400">
        Deleted photos and videos wait here for {RECOVERY_DAYS} days before they are removed for good.
        Anyone can restore them, collections included.
      </p>

      {error && (
        <p role="alert" className="text-sm text-rose-400">
          {error}
        </p>
      )}

      {items !== null && items.length === 0 && (
        <EmptyState
          icon={<IconTrash />}
          title="Nothing here"
          message="Photos and videos you delete will wait here for 30 days before disappearing for good."
        />
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items?.map((image) => (
          <li key={image.id} className="flex flex-col gap-1.5">
            <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-stone-900">
              {image.contentType.startsWith("video/") ? (
                <VideoPlaceholder className="opacity-60" />
              ) : (
                <img
                  src={api.mediaUrl(image.mediaKey, "thumb")}
                  alt={image.caption ?? image.originalName}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover opacity-60"
                />
              )}
              {image.deletedAt && (
                <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums text-stone-300">
                  {daysLeft(image.deletedAt)} days left
                </span>
              )}
            </div>
            <div className="truncate px-0.5 text-[11px] text-stone-500">
              Deleted by {image.deletedBy ?? "Unknown"}
            </div>
            <button
              onClick={() => void restore(image.id)}
              disabled={busyId === image.id}
              className="min-h-10 rounded-lg bg-stone-800 text-xs font-medium text-stone-200 hover:bg-stone-700 disabled:opacity-50"
            >
              {busyId === image.id ? "Restoring…" : "Restore"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
