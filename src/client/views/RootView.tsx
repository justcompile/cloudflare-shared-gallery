import { useCallback, useEffect, useState } from "react";
import type { ApiCollection } from "../../shared/types";
import * as api from "../lib/api";
import { subscribe } from "../lib/events";
import { useImageFeed } from "../lib/useImageFeed";
import CollectionTile from "../components/CollectionTile";
import PhotoSection from "../components/PhotoSection";
import EmptyState from "../components/EmptyState";
import { IconImage } from "../components/icons";

/**
 * Root (default home): a file-explorer style view — collection folders
 * first, then the untagged loose media below them.
 */
export default function RootView({
  onOpenCollection,
}: {
  onOpenCollection: (id: string) => void;
}) {
  const [collections, setCollections] = useState<ApiCollection[] | null>(null);
  const feed = useImageFeed({ kind: "untagged" });

  const loadCollections = useCallback(() => {
    api.listCollections().then(setCollections).catch(() => setCollections((prev) => prev ?? []));
  }, []);

  useEffect(() => {
    loadCollections();
    const unsub1 = subscribe("collections-changed", loadCollections);
    const unsub2 = subscribe("images-changed", loadCollections);
    return () => {
      unsub1();
      unsub2();
    };
  }, [loadCollections]);

  const noCollections = collections !== null && collections.length === 0;
  const noLoosePhotos = feed.ready && feed.images.length === 0;

  if (noCollections && noLoosePhotos) {
    return (
      <EmptyState
        icon={<img src="/icons/icon-192.png" alt="" className="mx-auto h-16 w-16 rounded-2xl" />}
        title="Your gallery is empty"
        message="Tap the + button to upload the first photos or videos. Anyone with the shared password can add theirs too."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {collections !== null && collections.length > 0 && (
        <section aria-label="Collections">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-widest text-stone-500">
            Collections
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {collections.map((c) => (
              <CollectionTile key={c.id} collection={c} onOpen={() => onOpenCollection(c.id)} />
            ))}
          </div>
        </section>
      )}

      <section aria-label="Photos not in any collection">
        <PhotoSection
          feed={feed}
          header={
            <h2 className="truncate text-sm font-medium uppercase tracking-widest text-stone-500">
              Loose media
            </h2>
          }
          emptyState={
            noCollections ? (
              <EmptyState
                icon={<IconImage />}
                title="No media yet"
                message="Tap the + button to add photos or videos to the gallery."
              />
            ) : (
              <p className="rounded-xl border border-dashed border-stone-800 px-4 py-8 text-center text-sm text-stone-500">
                Everything is filed away, no loose media. New uploads appear here until they're
                added to a collection.
              </p>
            )
          }
        />
      </section>
    </div>
  );
}
