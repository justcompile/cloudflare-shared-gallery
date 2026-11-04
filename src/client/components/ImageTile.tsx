import { useState } from "react";
import type { ApiImage } from "../../shared/types";
import { mediaSrcSet, mediaUrl } from "../lib/api";
import { getSessionSince } from "../lib/lastSeen";
import { getStoredDisplayName } from "../lib/user";
import { IconCheck } from "./icons";
import VideoPlaceholder from "./VideoPlaceholder";
import VideoBadge from "./VideoBadge";

/** Sizes hint matching the grid's column breakpoints. */
export const TILE_SIZES =
  "(min-width: 1536px) 16vw, (min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw";

export default function ImageTile({
  image,
  onPress,
  selectable = false,
  selected = false,
}: {
  image: ApiImage;
  /** shift is true for shift-clicks (range selection). */
  onPress: (opts: { shift: boolean }) => void;
  selectable?: boolean;
  selected?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);

  const alt = image.caption ?? image.originalName;
  const since = getSessionSince();
  const isNew =
    since !== null &&
    image.createdAt > since &&
    image.uploadedBy !== getStoredDisplayName();

  return (
    <button
      type="button"
      onClick={(e) => onPress({ shift: e.shiftKey })}
      aria-label={selectable ? `Select ${alt}` : `Open ${alt}`}
      aria-pressed={selectable ? selected : undefined}
      className={`group relative aspect-square w-full overflow-hidden rounded-lg bg-stone-900 outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
        selected ? "ring-2 ring-amber-400" : ""
      }`}
    >
      {!loaded && !image.contentType.startsWith("video/") && (
        <div className="absolute inset-0 animate-pulse bg-stone-800/80" aria-hidden />
      )}
      {image.contentType.startsWith("video/") ? (
        image.thumbnailKey ? (
          <img
            src={mediaUrl(image.thumbnailKey)}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={`h-full w-full object-cover transition-[opacity,transform] duration-300 motion-reduce:transition-none ${
              loaded ? "opacity-100" : "opacity-0"
            } ${selected ? "scale-95" : "group-hover:scale-[1.03]"}`}
          />
        ) : (
          <VideoPlaceholder />
        )
      ) : (
        <img
          src={mediaUrl(image.mediaKey, "thumb")}
          srcSet={mediaSrcSet(image.mediaKey)}
          sizes={TILE_SIZES}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition-[opacity,transform] duration-300 motion-reduce:transition-none ${
            loaded ? "opacity-100" : "opacity-0"
          } ${selected ? "scale-95" : "group-hover:scale-[1.03]"}`}
        />
      )}
      {isNew && (
        <span
          className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(12,10,9,0.6)]"
          title="New since your last visit"
        >
          <span className="sr-only">New since your last visit</span>
        </span>
      )}
      {image.contentType.startsWith("video/") && image.thumbnailKey && <VideoBadge />}
      {selectable && (
        <span
          aria-hidden
          className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border text-xs transition ${
            selected
              ? "border-amber-400 bg-amber-400 text-stone-950"
              : "border-white/70 bg-black/30 text-transparent"
          }`}
        >
          <IconCheck width="0.9em" height="0.9em" />
        </span>
      )}
    </button>
  );
}
