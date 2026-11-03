import { useRef, useState, type ReactNode } from "react";
import { IconDeviceCamera, IconImage } from "./icons";

/**
 * Upload trigger. The library accepts supported images and videos with
 * multi-select; `withCameraSheet` adds an action sheet offering direct
 * camera capture (`capture="environment"`) on mobile. Chosen files are
 * handed to onFiles (the Shell gates on display name and feeds the shared
 * upload queue).
 */
export default function UploadButton({
  onFiles,
  className,
  withCameraSheet = false,
  children,
}: {
  onFiles: (files: File[]) => void;
  className?: string;
  withCameraSheet?: boolean;
  children: ReactNode;
}) {
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const inputProps = {
    className: "hidden",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) onFiles(files);
      e.target.value = "";
    },
  };

  return (
    <>
      <input
        ref={libraryRef}
        type="file"
        accept="image/*,video/mp4,video/webm,video/quicktime"
        multiple
        {...inputProps}
      />
      {withCameraSheet && (
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" {...inputProps} />
      )}
      <button
        type="button"
        onClick={() => (withCameraSheet ? setSheetOpen(true) : libraryRef.current?.click())}
        className={className}
      >
        {children}
      </button>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Add media"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSheetOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl border border-b-0 border-stone-800 bg-stone-900 p-3"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
          >
            <button
              onClick={() => {
                setSheetOpen(false);
                libraryRef.current?.click();
              }}
              className="flex w-full min-h-12 items-center gap-3 rounded-xl px-4 text-left text-base text-stone-100 hover:bg-stone-800"
            >
              <IconImage className="text-stone-400" /> Choose photos or videos
            </button>
            <button
              onClick={() => {
                setSheetOpen(false);
                cameraRef.current?.click();
              }}
              className="flex w-full min-h-12 items-center gap-3 rounded-xl px-4 text-left text-base text-stone-100 hover:bg-stone-800"
            >
              <IconDeviceCamera className="text-stone-400" /> Take a photo
            </button>
            <button
              onClick={() => setSheetOpen(false)}
              className="mt-1 block w-full min-h-12 rounded-xl px-4 text-center text-sm text-stone-400 hover:bg-stone-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
