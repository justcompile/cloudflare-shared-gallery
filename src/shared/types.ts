/**
 * API data shapes shared between the Worker and the React client.
 * All timestamps are Unix epoch milliseconds.
 */

export interface ApiImage {
  id: string;
  /** R2 object key; image bytes live at /media/{mediaKey}. */
  mediaKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  /** Doubles as alt text. */
  caption: string | null;
  uploadedBy: string | null;
  /** EXIF capture time (epoch ms) when the original carried one. */
  takenAt: number | null;
  /** EXIF camera make/model when the original carried one. */
  camera: string | null;
  /** Set while the photo sits in Recently deleted (soft delete). */
  deletedAt: number | null;
  deletedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ApiImageMembership {
  collectionId: string;
  name: string;
  slug: string;
  addedBy: string | null;
  addedAt: number;
}

export interface ApiImageDetail extends ApiImage {
  collections: ApiImageMembership[];
}

export interface ApiCollection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  coverImageId: string | null;
  sortOrder: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  memberCount: number;
  /** Explicit cover, falling back to the most recently added member. */
  cover: ApiImage | null;
}

export interface ApiCollectionDetail extends ApiCollection {
  images: ApiImage[];
  cursor: string | null;
}

export interface Paginated<T> {
  items: T[];
  /** Opaque cursor for the next page; null when exhausted. */
  cursor: string | null;
}

export type ImageFilter = "all" | "untagged";

export const IMAGE_SORTS = [
  "newest",
  "oldest",
  "capture-newest",
  "capture-oldest",
  "filename-asc",
  "filename-desc",
  "size-desc",
  "size-asc",
  "uploader-asc",
  "uploader-desc",
] as const;

export type ImageSort = (typeof IMAGE_SORTS)[number];

export function isImageSort(value: string): value is ImageSort {
  return IMAGE_SORTS.some((sort) => sort === value);
}

export interface ApiError {
  error: string;
}

export interface ApiStats {
  imageCount: number;
  /** Distinct attribution names across uploads, tagging, and collections. */
  contributorCount: number;
  /** Sum of stored original sizes (the R2 bucket holds originals only). */
  bytesUsed: number;
  /** Free-plan R2 allowance. */
  bytesLimit: number;
}

export interface ApiUpdates {
  /** Photos added by others since the given watermark. */
  newCount: number;
  /** Newest photo timestamp overall; the client's next watermark. */
  latestCreatedAt: number | null;
}
