import { useEffect, useState } from "react";
import type { ApiCollection } from "../../shared/types";
import * as api from "../lib/api";
import { emit } from "../lib/events";
import type { UploadBatch } from "../lib/uploadQueue";

type Phase = "choose" | "applying" | "error";

/**
 * Shown after a multi-file upload starts: file the whole batch into an
 * existing collection, a brand new one, or leave everything untagged.
 * Uploads keep running in the background; tagging applies once the batch
 * settles, to exactly the files that uploaded successfully.
 */
export default function BatchTagPrompt({
  batch,
  onClose,
}: {
  batch: UploadBatch;
  onClose: () => void;
}) {
  const [collections, setCollections] = useState<ApiCollection[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [phase, setPhase] = useState<Phase>("choose");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  async function apply() {
    setPhase("applying");
    setError(null);
    try {
      const ids = await batch.settled;
      if (ids.length === 0) {
        onClose();
        return;
      }
      let collectionId = selected;
      if (!collectionId) {
        const created = await api.createCollection({ name: newName.trim() });
        collectionId = created.id;
      }
      // The API caps one request at 200 ids; chunk large batches.
      for (let i = 0; i < ids.length; i += 150) {
        await api.addImagesToCollection(collectionId, ids.slice(i, i + 150));
      }
      emit("collections-changed");
      emit("images-changed");
      onClose();
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Couldn't add the items");
    }
  }

  const canApply = selected !== null || newName.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-tag-title"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl border border-stone-800 bg-stone-900 shadow-2xl"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="border-b border-stone-800 px-5 py-4">
          <h2 id="batch-tag-title" className="text-lg font-semibold text-stone-100">
            Put these {batch.count} items in a collection?
          </h2>
          <p className="mt-0.5 text-xs text-stone-500">
            Uploads carry on in the background either way.
          </p>
        </div>

        {phase === "applying" ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10" role="status">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-700 border-t-amber-400" />
            <p className="text-sm text-stone-400">
              Filing items as soon as the uploads finish…
            </p>
          </div>
        ) : (
          <>
            <div className="min-h-16 flex-1 overflow-y-auto p-2">
              {collections === null && (
                <div className="flex justify-center py-6" role="status" aria-label="Loading collections">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-700 border-t-amber-400" />
                </div>
              )}
              {collections?.map((c) => (
                <label
                  key={c.id}
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 hover:bg-stone-800/70"
                >
                  <input
                    type="radio"
                    name="batch-collection"
                    checked={selected === c.id}
                    onChange={() => {
                      setSelected(c.id);
                      setNewName("");
                    }}
                    className="h-4 w-4 shrink-0 accent-amber-400"
                  />
                  <span className="flex-1 truncate text-sm text-stone-200">{c.name}</span>
                  <span className="text-xs tabular-nums text-stone-500">{c.memberCount}</span>
                </label>
              ))}
              {collections?.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-stone-500">
                  No collections yet. Name the first one below.
                </p>
              )}
            </div>

            <div className="border-t border-stone-800 p-3">
              <input
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (e.target.value.trim().length > 0) setSelected(null);
                }}
                maxLength={100}
                placeholder="Or create a new collection"
                aria-label="New collection name"
                className="w-full min-h-11 rounded-lg border border-stone-700 bg-stone-950 px-3 text-sm text-stone-100 outline-none placeholder:text-stone-500 focus:border-amber-400"
              />
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
                  Leave untagged
                </button>
                <button
                  onClick={() => void apply()}
                  disabled={!canApply}
                  className="min-h-11 rounded-xl bg-amber-400 px-5 text-sm font-medium text-stone-950 hover:bg-amber-300 disabled:opacity-50"
                >
                  {phase === "error" ? "Try again" : `Add ${batch.count} items`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
