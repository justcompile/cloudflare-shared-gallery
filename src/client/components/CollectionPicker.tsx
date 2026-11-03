import { useEffect, useRef, useState } from "react";
import type { ApiCollection } from "../../shared/types";
import * as api from "../lib/api";
import { emit } from "../lib/events";
import { getStoredDisplayName } from "../lib/user";
import DisplayNamePrompt from "./DisplayNamePrompt";

/**
 * Checklist of collections for tagging. Membership is many-to-many, so
 * ticking several collections is expected and normal.
 *
 * Single image: boxes reflect current memberships; saving applies both adds
 * and removals. Multiple images: boxes start empty; saving adds all selected
 * images to the ticked collections (idempotent server-side).
 */
export default function CollectionPicker({
  imageIds,
  current,
  onClose,
  onApplied,
}: {
  imageIds: string[];
  current?: Set<string>;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const single = imageIds.length === 1 && current !== undefined;
  const [collections, setCollections] = useState<ApiCollection[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(current ?? []));
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsName, setNeedsName] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .listCollections()
      .then(setCollections)
      .catch(() => setError("Couldn't load collections"));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // Capture phase so an underlying lightbox doesn't also close.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createCollection() {
    const name = newName.trim();
    if (name.length === 0 || creating) return;
    if (!getStoredDisplayName()) {
      setNeedsName(true);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await api.createCollection({ name });
      setCollections((prev) => [...(prev ?? []), created]);
      setChecked((prev) => new Set(prev).add(created.id));
      setNewName("");
      emit("collections-changed");
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create collection");
    } finally {
      setCreating(false);
    }
  }

  async function apply() {
    if (busy) return;
    if (!getStoredDisplayName()) {
      setNeedsName(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const adds = [...checked].filter((id) => !single || !current?.has(id));
      const removes = single ? [...(current ?? [])].filter((id) => !checked.has(id)) : [];
      for (const collectionId of adds) {
        await api.addImagesToCollection(collectionId, imageIds);
      }
      for (const collectionId of removes) {
        await api.removeImageFromCollection(collectionId, imageIds[0]);
      }
      emit("collections-changed");
      emit("images-changed");
      onApplied?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update collections");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-title"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl border border-stone-800 bg-stone-900 shadow-2xl"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="border-b border-stone-800 px-5 py-4">
          <h2 id="picker-title" className="text-lg font-semibold text-stone-100">
            {single
              ? "Collections for this item"
              : `Add ${imageIds.length} items to collections`}
          </h2>
          <p className="mt-0.5 text-xs text-stone-500">
            Photos and videos can live in any number of collections.
          </p>
        </div>

        <div ref={listRef} className="min-h-24 flex-1 overflow-y-auto p-2">
          {collections === null && !error && (
            <div className="flex justify-center py-8" role="status" aria-label="Loading collections">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-700 border-t-amber-400" />
            </div>
          )}
          {collections?.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-stone-500">
              No collections yet. Create the first one below.
            </p>
          )}
          {collections?.map((c) => (
            <label
              key={c.id}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 hover:bg-stone-800/70"
            >
              <input
                type="checkbox"
                checked={checked.has(c.id)}
                onChange={() => toggle(c.id)}
                className="h-5 w-5 shrink-0 accent-amber-400"
              />
              <span className="flex-1 truncate text-sm text-stone-200">{c.name}</span>
              <span className="text-xs tabular-nums text-stone-500">{c.memberCount}</span>
            </label>
          ))}
        </div>

        <div className="border-t border-stone-800 p-3">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createCollection();
                }
              }}
              maxLength={100}
              placeholder="New collection name"
              aria-label="New collection name"
              className="min-h-11 flex-1 rounded-lg border border-stone-700 bg-stone-950 px-3 text-sm text-stone-100 outline-none placeholder:text-stone-500 focus:border-amber-400"
            />
            <button
              onClick={() => void createCollection()}
              disabled={creating || newName.trim().length === 0}
              className="min-h-11 rounded-lg bg-stone-800 px-3 text-sm text-stone-200 hover:bg-stone-700 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-rose-400">
              {error}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="min-h-11 rounded-lg px-3 text-sm text-stone-400 hover:text-stone-200"
            >
              Cancel
            </button>
            <button
              onClick={() => void apply()}
              disabled={busy}
              className="min-h-11 rounded-xl bg-amber-400 px-5 text-sm font-medium text-stone-950 hover:bg-amber-300 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
      {needsName && (
        <DisplayNamePrompt allowSkip={false} onDone={() => setNeedsName(false)} />
      )}
    </div>
  );
}
