import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Route } from "../lib/router";
import { enqueueUploads, type UploadBatch } from "../lib/uploadQueue";
import BatchTagPrompt from "./BatchTagPrompt";
import { getStoredDisplayName } from "../lib/user";
import { checkVisitUpdates } from "../lib/lastSeen";
import { IconX } from "./icons";
import ViewSwitcher from "./ViewSwitcher";
import SettingsMenu from "./SettingsMenu";
import UploadButton from "./UploadButton";
import UploadTray from "./UploadTray";
import OfflineBanner from "./OfflineBanner";
import DropZone from "./DropZone";
import DisplayNamePrompt from "./DisplayNamePrompt";
import BzwrdCredit from "./BzwrdCredit";
import FooterStats from "./FooterStats";
import { IconMarkGithub, IconPlus } from "./icons";

/**
 * App chrome: compact top bar plus bottom navigation on mobile, single top
 * bar on desktop. Files can arrive from the upload buttons, the camera
 * sheet, or a drag-and-drop anywhere on the page — all funnel through
 * handleFiles, which enforces the display-name-before-first-upload rule and
 * feeds the shared, concurrency-limited upload queue.
 */
export default function Shell({
  route,
  onNavigate,
  onLoggedOut,
  children,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  onLoggedOut: () => void;
  children: ReactNode;
}) {
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [tagPrompt, setTagPrompt] = useState<UploadBatch | null>(null);
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    void checkVisitUpdates().then((u) => setNewCount(u.newCount));
  }, []);

  const startUpload = useCallback((media: File[]) => {
    const batch = enqueueUploads(media);
    // Multi-file uploads offer batch filing into a collection.
    if (media.length >= 2) setTagPrompt(batch);
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const media = files.filter(
        (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
      );
      if (media.length === 0) return;
      // Attribution must be set before the first upload (PRD section 6).
      if (!getStoredDisplayName()) {
        setPendingFiles(media);
        return;
      }
      startUpload(media);
    },
    [startUpload],
  );

  return (
    <div className="flex min-h-full flex-col bg-stone-950 text-stone-100">
      <header
        className="sticky top-0 z-30 border-b border-stone-800/80 bg-stone-950/90 backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2">
          <button
            onClick={() => onNavigate({ name: "root" })}
            className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"
            aria-label="Go home"
          >
            <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
            Shared<span className="-ml-1 text-amber-400">Gallery</span>
          </button>
          <div className="hidden sm:block">
            <ViewSwitcher route={route} onNavigate={onNavigate} orientation="top" />
          </div>
          <div className="flex items-center gap-1">
            <UploadButton
              onFiles={handleFiles}
              className="hidden min-h-11 items-center gap-2 rounded-xl bg-amber-400 px-4 text-sm font-medium text-stone-950 hover:bg-amber-300 sm:flex"
            >
              <IconPlus width="0.9em" height="0.9em" /> Upload
            </UploadButton>
            <SettingsMenu onLoggedOut={onLoggedOut} />
          </div>
        </div>
        <OfflineBanner />
        {newCount > 0 && (
          <div
            role="status"
            className="flex items-center justify-center gap-2 border-t border-amber-500/20 bg-amber-400/10 px-4 py-1.5 text-xs text-amber-300"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
            {newCount === 1
              ? "1 new item since your last visit"
              : `${newCount} new items since your last visit`}
            <button
              onClick={() => setNewCount(0)}
              aria-label="Dismiss new items notice"
              className="ml-1 rounded p-1 text-amber-400/70 hover:text-amber-300"
            >
              <IconX width="0.8em" height="0.8em" />
            </button>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-3 pt-3 sm:px-4">
        {children}
      </main>

      <footer className="mx-auto flex w-full max-w-7xl flex-col items-center gap-4 px-4 pb-28 pt-12 sm:pb-8">
        <FooterStats />
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <a
            href="https://github.com/Zesty0wl/cloudflare-shared-gallery"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300"
          >
            <IconMarkGithub width="1.2em" height="1.2em" />
            Open source on GitHub
          </a>
          <span className="text-stone-700" aria-hidden>
            ·
          </span>
          <BzwrdCredit />
        </div>
      </footer>

      {/* Mobile bottom navigation */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-800/80 bg-stone-950/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-2 px-3 py-1.5">
          <ViewSwitcher route={route} onNavigate={onNavigate} orientation="bottom" />
          <UploadButton
            onFiles={handleFiles}
            withCameraSheet
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xl font-bold text-stone-950 shadow-lg hover:bg-amber-300"
          >
            <IconPlus />
            <span className="sr-only">Upload photos or videos</span>
          </UploadButton>
        </div>
      </div>

      <DropZone onFiles={handleFiles} />
      <UploadTray />

      {pendingFiles && (
        <DisplayNamePrompt
          allowSkip={false}
          onDone={(name) => {
            const files = pendingFiles;
            setPendingFiles(null);
            if (name && files) startUpload(files);
          }}
        />
      )}

      {tagPrompt && <BatchTagPrompt batch={tagPrompt} onClose={() => setTagPrompt(null)} />}
    </div>
  );
}
