"use client";

import { useEffect, useState } from "react";

/** Countdown to the next live poll, or in-flight label while fetching. */
export function LiveRefreshCountdown({
  checking,
  lastUpdatedAt,
  intervalMs,
  title,
  className = "text-slate-400",
}: {
  checking: boolean;
  lastUpdatedAt: Date | null;
  intervalMs: number;
  title?: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (checking) {
    return (
      <span className={`font-normal ${className}`} aria-live="polite">
        {" · refreshing…"}
      </span>
    );
  }

  if (!lastUpdatedAt) return null;

  const elapsed = now - lastUpdatedAt.getTime();
  const remaining = Math.max(0, Math.ceil((intervalMs - elapsed) / 1000));

  return (
    <span className={`font-normal tabular-nums ${className}`} title={title}>
      {remaining > 0 ? ` · ${remaining}s` : " · now"}
    </span>
  );
}
