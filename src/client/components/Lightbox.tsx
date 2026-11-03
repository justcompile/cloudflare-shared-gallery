import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiImage, ApiImageDetail } from "../../shared/types";
import * as api from "../lib/api";
import { navigateTo } from "../lib/router";
import {
  IconChevronLeft,
  IconChevronRight,
  IconDeviceCamera,
  IconDownload,
  IconInfo,
  IconStack,
  IconTrash,
  IconX,
} from "./icons";

/**
 * Full-screen viewer over the current view's media set.
 * Desktop: arrow keys navigate, Escape closes, focus is trapped.
 * Touch: horizontal swipe navigates, downward swipe or backdrop tap closes.
 */
export default function Lightbox({
  images,
  index,
  onNavigate,
  onClose,
  onImageUpdated,
  onImageDeleted,
  onNearEnd,
  onEditCollections,
}: {
  images: ApiImage[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
  onImageUpdated: (img: ApiImage) => void;
  onImageDeleted: (id: string) => void;
  /** Called when the viewer nears the end of the loaded set (paginate ahead). */
  onNearEnd?: () => void;
  /** Opens the collection picker for the current image (Phase 5+). */
  onEditCollections?: (detail: ApiImageDetail) => void;
}) {
  const image = images[index];
  const isVideo = image?.contentType.startsWith("video/") ?? false;
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const [detail, setDetail] = useState<ApiImageDetail | null>(null);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const prev = useCallback(() => {
    if (index > 0) onNavigate(index - 1);
  }, [index, onNavigate]);

  const next = useCallback(() => {
    if (index < images.length - 1) onNavigate(index + 1);
  }, [index, images.length, onNavigate]);

  // Load memberships + reset per-image UI state on image change.
  useEffect(() => {
    if (!image) return;
    setDetail(null);
    setEditingCaption(false);
    setConfirmingDelete(false);
    setActionError(null);
    let cancelled = false;
    api
      .getImage(image.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        /* memberships are supplementary; the lightbox still works */
      });
    return () => {
      cancelled = true;
    };
  }, [image?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preload neighbours so navigation feels instant.
  useEffect(() => {
    for (const neighbour of [images[index - 1], images[index + 1]]) {
      if (neighbour && !neighbour.contentType.startsWith("video/")) {
        new Image().src = api.mediaUrl(neighbour.mediaKey, "full");
      }
    }
    if (onNearEnd && index >= images.length - 3) onNearEnd();
  }, [index, images, onNearEnd]);

  // Keyboard controls + focus trap.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    containerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT");
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.key === "i" || e.key === "I") && !typing) {
        e.preventDefault();
        setShowInfo((v) => !v);
      } else if (e.key === "ArrowLeft") {
        prev();
      } else if (e.key === "ArrowRight") {
        next();
      } else if (e.key === "Tab") {
        const focusables = containerRef.current?.querySelectorAll<HTMLElement>(
          'button, a[href], textarea, input, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const list = Array.from(focusables);
        const current = document.activeElement as HTMLElement | null;
        const pos = current ? list.indexOf(current) : -1;
        e.preventDefault();
        const nextPos = e.shiftKey
          ? (pos - 1 + list.length) % list.length
          : (pos + 1) % list.length;
        list[nextPos].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      (restoreFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose, prev, next]);

  if (!image) return null;

  async function saveCaption() {
    if (!image || busy) return;
    setBusy(true);
    try {
      const trimmed = captionDraft.trim();
      const updated = await api.updateCaption(image.id, trimmed.length > 0 ? trimmed : null);
      setDetail(updated);
      onImageUpdated(updated);
      setEditingCaption(false);
      setActionError(null);
    } catch {
      // Keep the editor open so nothing typed is lost.
      setActionError("Couldn't save the caption. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrent() {
    if (!image || busy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    try {
      await api.deleteImage(image.id);
      const id = image.id;
      if (images.length <= 1) onClose();
      else if (index === images.length - 1) onNavigate(index - 1);
      onImageDeleted(id);
    } catch {
      setConfirmingDelete(false);
      setActionError("Couldn't delete the item. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) return;
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!touchStart.current || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;
    setDrag({ dx, dy: Math.max(0, dy) });
  }

  function onTouchEnd() {
    const d = drag;
    touchStart.current = null;
    setDrag(null);
    if (!d) return;
    if (Math.abs(d.dx) > 60 && Math.abs(d.dx) > Math.abs(d.dy)) {
      if (d.dx < 0) next();
      else prev();
    } else if (d.dy > 80) {
      onClose();
    }
  }

  const caption = detail?.caption ?? image.caption;
  const uploadedBy = detail?.uploadedBy ?? image.uploadedBy;
  const memberships = detail?.collections ?? [];

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={caption ?? image.originalName}
      className="fixed inset-0 z-50 flex flex-col bg-black/95 outline-none"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2 text-stone-200">
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl hover:bg-white/10"
        >
          <IconX width="0.9em" height="0.9em" />
        </button>
        <span className="text-sm tabular-nums text-stone-400">
          {index + 1} / {images.length}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowInfo((v) => !v)}
            aria-label="Item details"
            aria-pressed={showInfo}
            aria-keyshortcuts="i"
            className={`flex h-11 w-11 items-center justify-center rounded-full text-lg hover:bg-white/10 ${
              showInfo ? "bg-white/15 text-amber-400" : ""
            }`}
          >
            <IconInfo width="0.9em" height="0.9em" />
          </button>
          <a
            href={api.mediaUrl(image.mediaKey)}
            download={image.originalName}
            aria-label="Download original"
            className="flex h-11 w-11 items-center justify-center rounded-full text-lg hover:bg-white/10"
          >
            <IconDownload width="0.9em" height="0.9em" />
          </a>
          {onEditCollections && (
            <button
              onClick={() => detail && onEditCollections(detail)}
              disabled={!detail}
              aria-label="Add to collections"
              className="flex h-11 w-11 items-center justify-center rounded-full text-lg hover:bg-white/10 disabled:opacity-40"
            >
              <IconStack width="0.9em" height="0.9em" />
            </button>
          )}
          <button
            onClick={() => void deleteCurrent()}
            disabled={busy}
            aria-label={confirmingDelete ? "Tap again to move to Recently deleted" : "Delete item"}
            className={`flex h-11 items-center justify-center rounded-full px-3 text-lg hover:bg-white/10 ${
              confirmingDelete ? "bg-rose-600/80 text-sm font-medium text-white" : "w-11"
            }`}
          >
            {confirmingDelete ? "Delete?" : <IconTrash width="0.9em" height="0.9em" />}
          </button>
        </div>
      </div>

      {/* Media area — backdrop tap closes, tap on media does not */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        onTouchStart={isVideo ? undefined : onTouchStart}
        onTouchMove={isVideo ? undefined : onTouchMove}
        onTouchEnd={isVideo ? undefined : onTouchEnd}
      >
        {isVideo ? (
          <video
            key={image.id}
            src={api.mediaUrl(image.mediaKey)}
            aria-label={caption ?? image.originalName}
            controls
            playsInline
            preload="metadata"
            className="max-h-full max-w-full"
          />
        ) : (
          <img
            key={image.id}
            src={api.mediaUrl(image.mediaKey, "full")}
            alt={caption ?? image.originalName}
            className="max-h-full max-w-full select-none object-contain transition-transform duration-75 motion-reduce:transition-none"
            style={
              drag
                ? { transform: `translate(${drag.dx}px, ${drag.dy}px)`, opacity: drag.dy > 40 ? 0.7 : 1 }
                : undefined
            }
            draggable={false}
          />
        )}
        {index > 0 && (
          <button
            onClick={prev}
            aria-label="Previous item"
            className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-xl text-white hover:bg-black/70 sm:flex"
          >
            <IconChevronLeft width="0.9em" height="0.9em" />
          </button>
        )}
        {index < images.length - 1 && (
          <button
            onClick={next}
            aria-label="Next item"
            className={`absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-xl text-white transition-[right] duration-200 hover:bg-black/70 sm:flex ${
              showInfo ? "sm:right-[356px]" : "right-2"
            }`}
          >
            <IconChevronRight width="0.9em" height="0.9em" />
          </button>
        )}

        {showInfo && (
          <InfoPane image={image} detail={detail} onClose={() => setShowInfo(false)} />
        )}
      </div>

      {/* Caption + metadata */}
      <div className="px-4 pb-3 pt-2 text-stone-200">
        {editingCaption ? (
          <div className="flex flex-col gap-2">
            <textarea
              autoFocus
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Describe this item"
              aria-label="Caption"
              className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingCaption(false)}
                className="min-h-11 rounded-lg px-3 text-sm text-stone-400 hover:text-stone-200"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveCaption()}
                disabled={busy}
                className="min-h-11 rounded-lg bg-amber-400 px-4 text-sm font-medium text-stone-950 hover:bg-amber-300 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save caption"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              setCaptionDraft(caption ?? "");
              setEditingCaption(true);
            }}
            className="block w-full rounded-lg px-1 py-1 text-left text-sm hover:bg-white/5"
            aria-label="Edit caption"
          >
            {caption ?? <span className="text-stone-500">Add a caption…</span>}
          </button>
        )}
        {actionError && (
          <p role="alert" className="mt-1 px-1 text-xs text-rose-400">
            {actionError}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-stone-500">
          {uploadedBy ? (
            <button
              onClick={() => navigateTo({ name: "uploader", who: uploadedBy })}
              className="rounded underline-offset-2 hover:text-stone-300 hover:underline"
              aria-label={`See all items uploaded by ${uploadedBy}`}
            >
              Uploaded by {uploadedBy}
            </button>
          ) : (
            <span>Uploaded by Unknown</span>
          )}
          <span>{new Date(image.createdAt).toLocaleDateString()}</span>
          {memberships.length > 0 && (
            <span className="truncate">In {memberships.map((m) => m.name).join(", ")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-stone-500">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm text-stone-200">{children}</div>
    </div>
  );
}

/**
 * Details overlay: a floating glass card over the media on desktop, a bottom
 * sheet on mobile. Toggled by the info button or the "i" key.
 */
function InfoPane({
  image,
  detail,
  onClose,
}: {
  image: ApiImage;
  detail: ApiImageDetail | null;
  onClose: () => void;
}) {
  const type = image.contentType.split("/")[1]?.toUpperCase() ?? image.contentType;
  const megapixels =
    image.width && image.height
      ? ((image.width * image.height) / 1_000_000).toFixed(1)
      : null;
  const memberships = detail?.collections ?? [];
  const taken = image.takenAt ? new Date(image.takenAt) : null;

  return (
    <aside
      aria-label="Photo details"
      className="sg-pane-in fixed inset-x-0 bottom-0 z-20 max-h-[60%] overflow-y-auto rounded-t-3xl border border-white/10 bg-stone-900/90 shadow-2xl backdrop-blur-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:max-h-[calc(100%-1.5rem)] sm:w-[336px] sm:rounded-2xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Grab handle (mobile) */}
      <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-stone-700 sm:hidden" aria-hidden />

      <div className="flex items-center justify-between px-5 pt-3 sm:pt-4">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.18em] text-stone-400">
          Details
        </h3>
        <button
          onClick={onClose}
          aria-label="Close details"
          className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-stone-400 hover:bg-white/10 hover:text-stone-200"
        >
          <IconX width="0.75em" height="0.75em" />
        </button>
      </div>

      {/* Capture: the headline fact */}
      <div className="px-5 pb-4 pt-1">
        {taken ? (
          <>
            <div className="text-lg font-semibold tracking-tight text-stone-100">
              {taken.toLocaleDateString(undefined, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </div>
            <div className="mt-0.5 text-sm text-stone-400">
              {taken.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </div>
          </>
        ) : (
          <div className="text-lg font-semibold tracking-tight text-stone-500">
            Capture date not recorded
          </div>
        )}
        {image.camera && (
          <div className="mt-2 flex items-center gap-2 text-sm text-stone-300">
            <IconDeviceCamera className="shrink-0 text-stone-500" />
            <span className="truncate">{image.camera}</span>
          </div>
        )}
      </div>

      <div className="mx-5 border-t border-white/10" aria-hidden />

      {/* Specs grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4">
        <Fact label="Resolution">
          {image.width && image.height ? `${image.width} × ${image.height}` : "Unknown"}
        </Fact>
        <Fact label="Megapixels">{megapixels ? `${megapixels} MP` : "—"}</Fact>
        <Fact label="Format">{type}</Fact>
        <Fact label="File size">{formatBytes(image.sizeBytes)}</Fact>
      </div>

      <div className="mx-5 border-t border-white/10" aria-hidden />

      {/* Provenance */}
      <div className="flex flex-col gap-3 px-5 py-4">
        <Fact label="Uploaded">
          {new Date(image.createdAt).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
          {image.uploadedBy ? (
            <>
              {" by "}
              <button
                onClick={() => navigateTo({ name: "uploader", who: image.uploadedBy! })}
                className="rounded text-stone-300 underline decoration-stone-600 underline-offset-2 hover:text-amber-400"
                aria-label={`See all items uploaded by ${image.uploadedBy}`}
              >
                {image.uploadedBy}
              </button>
            </>
          ) : (
            <span className="text-stone-400"> by Unknown</span>
          )}
        </Fact>
        <Fact label="Filename">
          <span className="font-mono text-xs text-stone-300" title={image.originalName}>
            {image.originalName}
          </span>
        </Fact>
      </div>

      {memberships.length > 0 && (
        <>
          <div className="mx-5 border-t border-white/10" aria-hidden />
          <div className="px-5 py-4">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-stone-500">
              Collections
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {memberships.map((m) => (
                <span
                  key={m.collectionId}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-stone-200"
                  title={`Tagged by ${m.addedBy ?? "Unknown"}`}
                >
                  {m.name}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
