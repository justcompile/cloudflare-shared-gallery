import { useEffect, useState } from "react";
import type { ApiStats } from "../../shared/types";
import * as api from "../lib/api";
import { subscribe } from "../lib/events";

function formatGB(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Quiet gallery totals for the footer: items, contributors, and storage
 * used against the Cloudflare Free-plan R2 allowance.
 */
export default function FooterStats() {
  const [stats, setStats] = useState<ApiStats | null>(null);

  useEffect(() => {
    const load = () => {
      api.getStats().then(setStats).catch(() => {
        /* stats are decorative; fail silently */
      });
    };
    load();
    const unsub1 = subscribe("images-changed", load);
    const unsub2 = subscribe("collections-changed", load);
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  if (!stats) return null;

  const fraction = Math.min(1, stats.bytesUsed / stats.bytesLimit);
  const nearLimit = fraction > 0.8;

  return (
    <div className="flex flex-col items-center gap-1.5 text-xs text-stone-500">
      <div className="flex flex-wrap items-center justify-center gap-x-2 tabular-nums">
        <span>{stats.imageCount === 1 ? "1 item" : `${stats.imageCount} items`}</span>
        <span aria-hidden>·</span>
        <span>
          {stats.contributorCount === 1
            ? "1 contributor"
            : `${stats.contributorCount} contributors`}
        </span>
        <span aria-hidden>·</span>
        <span>
          {formatGB(stats.bytesUsed)} of {formatGB(stats.bytesLimit)} used
        </span>
      </div>
      <div
        className="h-1 w-40 overflow-hidden rounded-full bg-stone-800"
        role="meter"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <div
          className={`h-full rounded-full ${nearLimit ? "bg-amber-400" : "bg-stone-600"}`}
          style={{ width: `${Math.max(1, Math.round(fraction * 100))}%` }}
        />
      </div>
    </div>
  );
}
