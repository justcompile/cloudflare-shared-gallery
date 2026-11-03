import type { ReactNode } from "react";

/** Action bar shown while multi-select mode is active. */
export default function SelectionBar({
  count,
  onCancel,
  children,
}: {
  count: number;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-x-3 z-40 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-stone-700 bg-stone-900/95 px-3 py-2 shadow-2xl backdrop-blur sm:left-1/2 sm:right-auto sm:w-auto sm:-translate-x-1/2 sm:flex-nowrap sm:gap-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }}
      role="toolbar"
      aria-label="Selection actions"
    >
      <span className="pl-1 text-sm tabular-nums text-stone-300">
        {count} selected
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">{children}</div>
      <button
        onClick={onCancel}
        className="min-h-11 rounded-lg px-2 text-sm text-stone-400 hover:text-stone-200"
      >
        Cancel
      </button>
    </div>
  );
}
