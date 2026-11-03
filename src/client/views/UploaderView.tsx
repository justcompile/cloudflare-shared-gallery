import { useImageFeed } from "../lib/useImageFeed";
import PhotoSection from "../components/PhotoSection";
import EmptyState from "../components/EmptyState";
import { IconImage } from "../components/icons";

/** Every item uploaded by one person. */
export default function UploaderView({ who, onBack }: { who: string; onBack: () => void }) {
  const feed = useImageFeed({ kind: "uploader", who });

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-stone-400">
        <button onClick={onBack} className="min-h-11 rounded-lg px-2 hover:text-stone-200">
          ‹ Media
        </button>
        <span aria-hidden>/</span>
        <span className="truncate px-1 text-stone-200">Uploaded by {who}</span>
      </nav>
      <PhotoSection
        feed={feed}
        header={
          <h2 className="truncate text-sm font-medium uppercase tracking-widest text-stone-500">
            Uploaded by {who}
            {feed.ready && (
              <span className="ml-2 normal-case tracking-normal text-stone-600">
                {feed.images.length}
                {feed.hasMore ? "+" : ""} items
              </span>
            )}
          </h2>
        }
        emptyState={
          <EmptyState
            icon={<IconImage />}
            title={`Nothing from ${who} yet`}
            message="Photos and videos they upload will show up here."
          />
        }
      />
    </div>
  );
}
