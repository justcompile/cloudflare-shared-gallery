import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiImage, ImageSort } from "../../shared/types";
import * as api from "./api";
import { subscribe } from "./events";

export type FeedSource =
  | { kind: "all" }
  | { kind: "untagged" }
  | { kind: "collection"; id: string }
  | { kind: "uploader"; who: string };

export interface ImageFeed {
  images: ApiImage[];
  sort: ImageSort;
  setSort: (sort: ImageSort) => void;
  loading: boolean;
  /** True once the first page has arrived (even if empty). */
  ready: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  /** Local mutations after edits/deletes so the UI updates instantly. */
  replaceImage: (img: ApiImage) => void;
  removeImage: (id: string) => void;
}

const PAGE_SIZE = 60;

/** Cursor-paginated image feed for a view, auto-refreshing on app events. */
export function useImageFeed(source: FeedSource): ImageFeed {
  const [images, setImages] = useState<ApiImage[]>([]);
  const [sort, setSort] = useState<ImageSort>("newest");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const sourceKey =
    source.kind === "collection"
      ? `collection:${source.id}`
      : source.kind === "uploader"
        ? `uploader:${source.who}`
        : source.kind;

  const fetchPage = useCallback(
    async (after: string | null, replace: boolean) => {
      const gen = ++generation.current;
      setLoading(true);
      setError(null);
      try {
        let page;
        if (source.kind === "collection") {
          const detail = await api.getCollection(source.id, {
            cursor: after,
            limit: PAGE_SIZE,
            sort,
          });
          page = { items: detail.images, cursor: detail.cursor };
        } else if (source.kind === "uploader") {
          page = await api.listImages({
            filter: "all",
            uploader: source.who,
            cursor: after,
            limit: PAGE_SIZE,
            sort,
          });
        } else {
          page = await api.listImages({
            filter: source.kind === "all" ? "all" : "untagged",
            cursor: after,
            limit: PAGE_SIZE,
            sort,
          });
        }
        if (gen !== generation.current) return;
        setImages((prev) => (replace ? page.items : [...prev, ...page.items]));
        setCursor(page.cursor);
        setHasMore(page.cursor !== null);
        setReady(true);
      } catch (err) {
        if (gen !== generation.current) return;
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        if (gen === generation.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceKey, sort],
  );

  const refresh = useCallback(() => {
    void fetchPage(null, true);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) void fetchPage(cursor, false);
  }, [fetchPage, loading, hasMore, cursor]);

  // Initial load + reload when the source changes.
  useEffect(() => {
    setImages([]);
    setCursor(null);
    setHasMore(true);
    setReady(false);
    void fetchPage(null, true);
  }, [fetchPage]);

  // Refresh when uploads or tagging change the underlying data.
  useEffect(() => {
    const unsub1 = subscribe("images-changed", refresh);
    const unsub2 = subscribe("collections-changed", refresh);
    return () => {
      unsub1();
      unsub2();
    };
  }, [refresh]);

  const replaceImage = useCallback((img: ApiImage) => {
    setImages((prev) => prev.map((i) => (i.id === img.id ? { ...i, ...img } : i)));
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((i) => i.id !== id));
  }, []);

  return {
    images,
    sort,
    setSort,
    loading,
    ready,
    error,
    hasMore,
    loadMore,
    refresh,
    replaceImage,
    removeImage,
  };
}
