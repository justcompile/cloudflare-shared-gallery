import { useCallback, useEffect, useState } from "react";
import type { ApiCollection } from "../../shared/types";
import * as api from "../lib/api";
import { subscribe } from "../lib/events";
import CollectionTile from "../components/CollectionTile";
import EmptyState from "../components/EmptyState";
import { IconAlert, IconStack } from "../components/icons";

/** Collections: a grid of folder tiles only. */
export default function Collections({
  onOpenCollection,
}: {
  onOpenCollection: (id: string) => void;
}) {
  const [collections, setCollections] = useState<ApiCollection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listCollections()
      .then((list) => {
        setCollections(list);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Couldn't load collections"),
      );
  }, []);

  useEffect(() => {
    load();
    const unsub1 = subscribe("collections-changed", load);
    const unsub2 = subscribe("images-changed", load);
    return () => {
      unsub1();
      unsub2();
    };
  }, [load]);

  if (error && !collections) {
    return (
      <EmptyState
        icon={<IconAlert />}
        title="Couldn't load collections"
        message={error}
        action={
          <button
            onClick={load}
            className="min-h-11 rounded-xl bg-stone-800 px-4 text-sm text-stone-200 hover:bg-stone-700"
          >
            Try again
          </button>
        }
      />
    );
  }

  if (collections === null) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-xl bg-stone-800/60" aria-hidden />
        ))}
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <EmptyState
        icon={<IconStack />}
        title="No collections yet"
        message="Collections are virtual folders, so photos and videos can live in as many as you like. Select items in any grid and choose “Add to collection” to create one."
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {collections.map((c) => (
        <CollectionTile key={c.id} collection={c} onOpen={() => onOpenCollection(c.id)} />
      ))}
    </div>
  );
}
