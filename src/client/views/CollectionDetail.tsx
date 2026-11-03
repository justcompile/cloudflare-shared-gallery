import { useCallback, useEffect, useState } from "react";
import type { ApiCollection } from "../../shared/types";
import * as api from "../lib/api";
import { emit, subscribe } from "../lib/events";
import { useImageFeed } from "../lib/useImageFeed";
import PhotoSection from "../components/PhotoSection";
import EmptyState from "../components/EmptyState";
import { IconStack } from "../components/icons";

/** One collection: header with rename/cover/delete controls plus its media. */
export default function CollectionDetail({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const [collection, setCollection] = useState<ApiCollection | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const feed = useImageFeed({ kind: "collection", id });

  const load = useCallback(() => {
    api
      .getCollection(id, { limit: 1 })
      .then((detail) => setCollection(detail))
      .catch((err: unknown) => {
        if (err instanceof api.ApiError && err.status === 404) setMissing(true);
      });
  }, [id]);

  useEffect(() => {
    load();
    return subscribe("collections-changed", load);
  }, [load]);

  if (missing) {
    return (
      <EmptyState
        icon={<IconStack />}
        title="Collection not found"
        message="It may have been deleted by another member."
        action={
          <button
            onClick={onBack}
            className="min-h-11 rounded-xl bg-stone-800 px-4 text-sm text-stone-200 hover:bg-stone-700"
          >
            Back to collections
          </button>
        }
      />
    );
  }

  async function saveEdits() {
    if (!collection || busy) return;
    const name = nameDraft.trim();
    if (name.length === 0) return;
    setBusy(true);
    try {
      const updated = await api.updateCollection(collection.id, {
        name,
        description: descDraft.trim().length > 0 ? descDraft.trim() : null,
      });
      setCollection(updated);
      setEditing(false);
      emit("collections-changed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCollection() {
    if (!collection || busy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    try {
      await api.deleteCollection(collection.id);
      emit("collections-changed");
      emit("images-changed");
      onBack();
    } finally {
      setBusy(false);
    }
  }

  async function setCover(imageId: string) {
    if (!collection) return;
    const updated = await api.updateCollection(collection.id, { coverImageId: imageId });
    setCollection(updated);
    emit("collections-changed");
  }

  async function removeFromCollection(imageIds: string[]) {
    if (!collection) return;
    for (const imageId of imageIds) {
      await api.removeImageFromCollection(collection.id, imageId);
      feed.removeImage(imageId);
    }
    emit("collections-changed");
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb / back navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-stone-400">
        <button onClick={onBack} className="min-h-11 rounded-lg px-2 hover:text-stone-200">
          ‹ Collections
        </button>
        <span aria-hidden>/</span>
        <span className="truncate px-1 text-stone-200">{collection?.name ?? "…"}</span>
      </nav>

      {collection && !editing && (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-stone-100">
              {collection.name}
            </h1>
            {collection.description && (
              <p className="mt-1 max-w-prose text-sm text-stone-400">{collection.description}</p>
            )}
            <p className="mt-1 text-xs text-stone-500">
              {collection.memberCount === 1 ? "1 item" : `${collection.memberCount} items`}
              {" · Created by "}
              {collection.createdBy ?? "Unknown"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setNameDraft(collection.name);
                setDescDraft(collection.description ?? "");
                setEditing(true);
                setConfirmingDelete(false);
              }}
              className="min-h-11 rounded-lg bg-stone-800 px-3 text-sm text-stone-200 hover:bg-stone-700"
            >
              Edit
            </button>
            <button
              onClick={() => void deleteCollection()}
              disabled={busy}
              className={`min-h-11 rounded-lg px-3 text-sm ${
                confirmingDelete
                  ? "bg-rose-600 font-medium text-white"
                  : "text-rose-400 hover:bg-stone-800"
              }`}
            >
              {confirmingDelete ? "Delete collection?" : "Delete"}
            </button>
          </div>
        </header>
      )}

      {collection && editing && (
        <div className="flex flex-col gap-2 rounded-xl border border-stone-800 bg-stone-900 p-4">
          <label className="text-xs text-stone-400" htmlFor="col-name">
            Name
          </label>
          <input
            id="col-name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={100}
            className="min-h-11 rounded-lg border border-stone-700 bg-stone-950 px-3 text-sm text-stone-100 outline-none focus:border-amber-400"
          />
          <label className="mt-1 text-xs text-stone-400" htmlFor="col-desc">
            Description
          </label>
          <textarea
            id="col-desc"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="What belongs in here?"
            className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 outline-none placeholder:text-stone-600 focus:border-amber-400"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="min-h-11 rounded-lg px-3 text-sm text-stone-400 hover:text-stone-200"
            >
              Cancel
            </button>
            <button
              onClick={() => void saveEdits()}
              disabled={busy || nameDraft.trim().length === 0}
              className="min-h-11 rounded-xl bg-amber-400 px-4 text-sm font-medium text-stone-950 hover:bg-amber-300 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <PhotoSection
        feed={feed}
        emptyState={
          <EmptyState
            icon={<IconStack />}
            title="Nothing in here yet"
            message="Select photos or videos in Home or Media and choose “Add to collection” to file them here."
          />
        }
        extraSelectionActions={({ selectedIds, clear }) => (
          <>
            {selectedIds.size === 1 && (
              <button
                onClick={() => {
                  void setCover([...selectedIds][0]).then(clear);
                }}
                className="min-h-11 rounded-lg bg-stone-800 px-3 text-sm text-stone-200 hover:bg-stone-700"
              >
                Set as cover
              </button>
            )}
            <button
              onClick={() => {
                void removeFromCollection([...selectedIds]).then(clear);
              }}
              className="min-h-11 rounded-lg bg-stone-800 px-3 text-sm text-rose-300 hover:bg-stone-700"
            >
              Remove
            </button>
          </>
        )}
      />
    </div>
  );
}
