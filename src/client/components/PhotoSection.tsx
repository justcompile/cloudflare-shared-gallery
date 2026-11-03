import { useRef, useState, type ReactNode } from "react";
import {
  IMAGE_SORTS,
  isImageSort,
  type ApiImageDetail,
  type ImageSort,
} from "../../shared/types";
import type { ImageFeed } from "../lib/useImageFeed";
import * as api from "../lib/api";
import ImageGrid from "./ImageGrid";
import Lightbox from "./Lightbox";
import CollectionPicker from "./CollectionPicker";
import SelectionBar from "./SelectionBar";
import EmptyState from "./EmptyState";
import { IconAlert, IconTrash } from "./icons";
import { emit } from "../lib/events";

const SORT_LABELS: Record<ImageSort, string> = {
  newest: "Recently added",
  oldest: "Oldest added",
  "capture-newest": "Capture date, newest",
  "capture-oldest": "Capture date, oldest",
  "filename-asc": "Filename, A to Z",
  "filename-desc": "Filename, Z to A",
  "size-desc": "Largest file",
  "size-asc": "Smallest file",
  "uploader-asc": "Uploader, A to Z",
  "uploader-desc": "Uploader, Z to A",
};

export interface SelectionContext {
  selectedIds: Set<string>;
  clear: () => void;
}

/**
 * A photo grid with everything attached: lightbox, multi-select (tap, or
 * shift-click for ranges) with add-to-collection and download actions, and
 * loading/error/empty states. Views compose this and can add extra selection
 * actions (e.g. remove from collection).
 */
export default function PhotoSection({
  feed,
  emptyState,
  header,
  extraSelectionActions,
}: {
  feed: ImageFeed;
  emptyState: ReactNode;
  /** Rendered above the grid, next to the Select toggle. */
  header?: ReactNode;
  extraSelectionActions?: (ctx: SelectionContext) => ReactNode;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ imageIds: string[]; current?: Set<string> } | null>(
    null,
  );
  /** Anchor for shift-click range selection. */
  const lastToggled = useRef<number | null>(null);

  function applySelection(index: number, shift: boolean) {
    const images = feed.images;
    // Capture the anchor now: the setState updater runs later (at render),
    // by which point lastToggled has already moved to this click.
    const anchor = lastToggled.current;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shift && anchor !== null && anchor < images.length) {
        const [from, to] = [Math.min(anchor, index), Math.max(anchor, index)];
        for (let i = from; i <= to; i++) next.add(images[i].id);
      } else {
        const id = images[index].id;
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    lastToggled.current = index;
  }

  function onTilePress(index: number, { shift }: { shift: boolean }) {
    if (selecting) {
      applySelection(index, shift);
      return;
    }
    if (shift) {
      // Shift-click outside select mode starts a selection with this anchor.
      setSelecting(true);
      applySelection(index, false);
      return;
    }
    setLightbox(index);
  }

  function clearSelection() {
    setSelecting(false);
    setSelectedIds(new Set());
    lastToggled.current = null;
  }

  /**
   * Downloads each selected original via a temporary anchor. Browsers prompt
   * once to allow multiple downloads; a small gap keeps them from being
   * swallowed.
   */
  async function downloadSelected() {
    if (downloading) return;
    setDownloading(true);
    try {
      const selected = feed.images.filter((i) => selectedIds.has(i.id));
      for (const image of selected) {
        const a = document.createElement("a");
        a.href = api.mediaUrl(image.mediaKey);
        a.download = image.originalName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setDownloading(false);
      clearSelection();
    }
  }

  async function deleteSelected() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const ids = [...selectedIds];
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        await api.deleteImages(batch);
        for (const id of batch) feed.removeImage(id);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of batch) next.delete(id);
          return next;
        });
      }
      emit("images-changed");
      emit("collections-changed");
      setConfirmingBulkDelete(false);
      clearSelection();
    } catch (err) {
      emit("images-changed");
      emit("collections-changed");
      lastToggled.current = null;
      setDeleteError(
        err instanceof Error
          ? err.message
          : "Couldn't move the selected items to Recently deleted",
      );
    } finally {
      setDeleting(false);
    }
  }

  function openPickerForDetail(detail: ApiImageDetail) {
    setPicker({
      imageIds: [detail.id],
      current: new Set(detail.collections.map((m) => m.collectionId)),
    });
  }

  if (feed.error && feed.images.length === 0) {
    return (
      <EmptyState
        icon={<IconAlert />}
        title="Couldn't load photos"
        message={feed.error}
        action={
          <button
            onClick={feed.refresh}
            className="min-h-11 rounded-xl bg-stone-800 px-4 text-sm text-stone-200 hover:bg-stone-700"
          >
            Try again
          </button>
        }
      />
    );
  }

  if (feed.ready && feed.images.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">{header}</div>
        {feed.images.length > 0 && (
          <div className="flex shrink-0 items-center gap-1">
            <label className="sr-only" htmlFor="media-sort">
              Sort media
            </label>
            <select
              id="media-sort"
              value={feed.sort}
              onChange={(e) => {
                if (!isImageSort(e.currentTarget.value)) return;
                feed.setSort(e.currentTarget.value);
                clearSelection();
              }}
              className="min-h-11 max-w-[9.5rem] rounded-lg border border-stone-800 bg-stone-900 px-2 text-xs text-stone-300 outline-none focus:border-amber-400 sm:max-w-none sm:px-3 sm:text-sm"
            >
              {IMAGE_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
            <button
              onClick={() => (selecting ? clearSelection() : setSelecting(true))}
              aria-pressed={selecting}
              className={`min-h-11 shrink-0 rounded-lg px-3 text-sm ${
                selecting
                  ? "bg-stone-800 text-amber-400"
                  : "text-stone-400 hover:bg-stone-900 hover:text-stone-200"
              }`}
            >
              {selecting ? "Done" : "Select"}
            </button>
          </div>
        )}
      </div>

      <ImageGrid
        images={feed.images}
        onTilePress={onTilePress}
        hasMore={feed.hasMore}
        loading={feed.loading}
        onLoadMore={feed.loadMore}
        selectable={selecting}
        selectedIds={selectedIds}
      />

      {selecting && selectedIds.size > 0 && (
        <SelectionBar count={selectedIds.size} onCancel={clearSelection}>
          <button
            onClick={() => setPicker({ imageIds: [...selectedIds] })}
            className="min-h-11 rounded-lg bg-amber-400 px-3 text-sm font-medium text-stone-950 hover:bg-amber-300"
          >
            Add to collection
          </button>
          <button
            onClick={() => void downloadSelected()}
            disabled={downloading}
            className="min-h-11 rounded-lg bg-stone-800 px-3 text-sm text-stone-200 hover:bg-stone-700 disabled:opacity-50"
          >
            {downloading ? "Downloading…" : "Download"}
          </button>
          <button
            onClick={() => {
              setDeleteError(null);
              setConfirmingBulkDelete(true);
            }}
            disabled={deleting}
            className="flex min-h-11 items-center gap-1.5 rounded-lg bg-stone-800 px-3 text-sm text-rose-300 hover:bg-stone-700 disabled:opacity-50"
          >
            <IconTrash width="0.9em" height="0.9em" />
            Delete
          </button>
          {extraSelectionActions?.({ selectedIds, clear: clearSelection })}
        </SelectionBar>
      )}

      {confirmingBulkDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-stone-800 bg-stone-900 p-5 shadow-2xl">
            <h2 id="bulk-delete-title" className="text-lg font-semibold text-stone-100">
              Move {selectedIds.size} {selectedIds.size === 1 ? "item" : "items"} to Recently deleted?
            </h2>
            <p className="mt-2 text-sm text-stone-400">
              You can restore them for 30 days. They will not be permanently deleted now.
            </p>
            {deleteError && (
              <p role="alert" className="mt-3 text-sm text-rose-400">
                {deleteError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirmingBulkDelete(false);
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="min-h-11 rounded-lg px-3 text-sm text-stone-300 hover:bg-stone-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void deleteSelected()}
                disabled={deleting || selectedIds.size === 0}
                className="min-h-11 rounded-lg bg-rose-600 px-4 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {deleting ? "Moving…" : "Move to Recently deleted"}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox !== null && feed.images[lightbox] && (
        <Lightbox
          images={feed.images}
          index={lightbox}
          onNavigate={setLightbox}
          onClose={() => setLightbox(null)}
          onImageUpdated={feed.replaceImage}
          onImageDeleted={feed.removeImage}
          onNearEnd={feed.loadMore}
          onEditCollections={openPickerForDetail}
        />
      )}

      {picker && (
        <CollectionPicker
          imageIds={picker.imageIds}
          current={picker.current}
          onClose={() => setPicker(null)}
          onApplied={clearSelection}
        />
      )}
    </>
  );
}
