import type { ApiCollection } from "../../shared/types";
import { mediaUrl } from "../lib/api";
import { IconStack } from "./icons";
import VideoPlaceholder from "./VideoPlaceholder";
import VideoBadge from "./VideoBadge";

/**
 * Collection folder tile, drawn as a small pile of prints: two offset,
 * slightly rotated "prints" peek out from behind the cover image.
 */
export default function CollectionTile({
  collection,
  onOpen,
}: {
  collection: ApiCollection;
  onOpen: () => void;
}) {
  const cover = collection.cover;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open collection ${collection.name}, ${collection.memberCount} items`}
      className="group flex w-full flex-col gap-2 rounded-xl p-2 text-left outline-none hover:bg-stone-900/60 focus-visible:ring-2 focus-visible:ring-amber-400"
    >
      <div className="relative aspect-square w-full">
        <div
          aria-hidden
          className="absolute inset-1 -rotate-3 rounded-lg bg-stone-800 transition-transform duration-300 group-hover:-rotate-6 motion-reduce:transition-none"
        />
        <div
          aria-hidden
          className="absolute inset-1 rotate-2 rounded-lg bg-stone-700/80 transition-transform duration-300 group-hover:rotate-4 motion-reduce:transition-none"
        />
        <div className="absolute inset-0 overflow-hidden rounded-lg bg-stone-800 shadow-md">
          {cover?.contentType.startsWith("video/") ? (
            cover.thumbnailKey ? (
              <img
                src={mediaUrl(cover.thumbnailKey)}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <VideoPlaceholder />
            )
          ) : cover ? (
            <img
              src={mediaUrl(cover.mediaKey, "thumb")}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl text-stone-600">
              <IconStack />
            </div>
          )}
        </div>
        {cover?.contentType.startsWith("video/") && cover.thumbnailKey && <VideoBadge />}
        <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-xs tabular-nums text-stone-200 backdrop-blur-sm">
          {collection.memberCount}
        </span>
      </div>
      <div className="px-1">
        <div className="truncate text-sm font-medium text-stone-200">{collection.name}</div>
        <div className="truncate text-xs text-stone-500">
          {collection.memberCount === 1 ? "1 item" : `${collection.memberCount} items`}
        </div>
      </div>
    </button>
  );
}
