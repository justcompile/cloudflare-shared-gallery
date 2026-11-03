import { useEffect, useRef, useState } from "react";

/**
 * Page-wide drag-and-drop target. Dragging files anywhere over the app shows
 * a full-screen overlay; dropping hands every image or video file (including
 * files inside dropped folders) to onFiles. Other files are skipped.
 */
export default function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (!e.dataTransfer) return;
      // Entries must be captured synchronously — DataTransferItems go stale
      // as soon as the handler yields.
      const entries: FileSystemEntry[] = [];
      const plainFiles: File[] = [];
      for (const item of e.dataTransfer.items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
        else {
          const file = item.getAsFile();
          if (file) plainFiles.push(file);
        }
      }
      void collectFiles(entries, plainFiles).then((files) => {
        const media = files.filter(
          (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
        );
        if (media.length > 0) onFiles(media);
      });
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onFiles]);

  if (!dragging) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-stone-950/80 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="mx-6 flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-amber-400/80 bg-stone-900/70 px-10 py-12 text-center shadow-2xl">
        <img src="/icons/icon-192.png" alt="" className="h-16 w-16 rounded-2xl shadow-lg" />
        <p className="text-xl font-semibold text-stone-100">Drop photos and videos to upload</p>
        <p className="text-sm text-stone-400">Folders work too. Other file types are skipped</p>
      </div>
    </div>
  );
}

/** Flattens dropped entries (files and directories, recursively) to Files. */
async function collectFiles(entries: FileSystemEntry[], seed: File[]): Promise<File[]> {
  const out: File[] = [...seed];
  for (const entry of entries) {
    await walk(entry, out);
  }
  return out;
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
    );
    if (file) out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most ~100 entries per call; loop until empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve, () => resolve([])),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, out);
    }
  }
}
