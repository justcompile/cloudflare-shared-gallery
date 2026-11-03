import { useEffect } from "react";
import {
  clearCompleted,
  dismiss,
  retryFailed,
  useUploadQueue,
} from "../lib/uploadQueue";
import { IconX } from "./icons";

/**
 * Aggregate upload progress, floating above the bottom nav. Built for big
 * batches: one overall bar ("87 of 300"), with only failures listed
 * individually (each retryable).
 */
export default function UploadTray() {
  const items = useUploadQueue();

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "error");
  const inFlight = total - done - failed.length;
  const overall = total > 0 ? items.reduce((sum, i) => sum + i.progress, 0) / total : 0;

  // When everything succeeded, let the tray linger briefly then clear.
  useEffect(() => {
    if (total === 0 || inFlight > 0 || failed.length > 0) return;
    const t = setTimeout(clearCompleted, 2500);
    return () => clearTimeout(t);
  }, [total, inFlight, failed.length]);

  if (total === 0) return null;

  return (
    <div
      className="fixed inset-x-3 z-40 sm:left-auto sm:w-96"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }}
      role="status"
      aria-live="polite"
    >
      <div className="rounded-xl border border-stone-800 bg-stone-900/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-stone-200">
            {inFlight > 0 ? (
              <>
                Uploading <span className="tabular-nums">{done + failed.length + 1}</span> of{" "}
                <span className="tabular-nums">{total}</span>
                {failed.length > 0 && (
                  <span className="text-rose-400"> · {failed.length} failed</span>
                )}
              </>
            ) : failed.length > 0 ? (
              <>
                <span className="tabular-nums">{done}</span> uploaded ·{" "}
                <span className="text-rose-400">
                  <span className="tabular-nums">{failed.length}</span> failed
                </span>
              </>
            ) : (
              <span className="text-emerald-400">
                {done === 1 ? "File uploaded" : `${done} files uploaded`}
              </span>
            )}
          </span>
          {inFlight === 0 && (
            <div className="flex items-center gap-2">
              {failed.length > 0 && (
                <button
                  onClick={() => retryFailed()}
                  className="text-xs font-medium text-amber-400 hover:text-amber-300"
                >
                  Retry all
                </button>
              )}
              <button
                onClick={() => dismiss()}
                aria-label="Dismiss upload status"
                className="text-xs text-stone-500 hover:text-stone-300"
              >
                <IconX />
              </button>
            </div>
          )}
        </div>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-800">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              inFlight === 0 && failed.length === 0 ? "bg-emerald-400" : "bg-amber-400"
            }`}
            style={{ width: `${Math.round(overall * 100)}%` }}
          />
        </div>

        {failed.length > 0 && (
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
            {failed.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-stone-400" title={item.name}>
                  {item.name}
                </span>
                <span className="max-w-40 truncate text-rose-400" title={item.error}>
                  {item.error}
                </span>
                <button
                  onClick={() => retryFailed(item.key)}
                  className="shrink-0 font-medium text-amber-400 hover:text-amber-300"
                >
                  Retry
                </button>
                <button
                  onClick={() => dismiss(item.key)}
                  aria-label={`Dismiss failed upload ${item.name}`}
                  className="shrink-0 text-stone-500 hover:text-stone-300"
                >
                  <IconX />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
