"use client";

import { useEffect, useState } from "react";

/**
 * Shared collapsible card. Client-controlled so fixture → game soft nav
 * re-applies defaultOpen (native <details open> often stays closed on RSC reuse).
 */
export function CollapsibleSection({
  title,
  description,
  children,
  defaultOpen = false,
  /** When this changes (e.g. game id), re-apply defaultOpen. */
  resetKey,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  resetKey?: string | number;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [resetKey, defaultOpen]);

  return (
    <details
      className="card group"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-start gap-2">
        <span className="mt-1 shrink-0 text-slate-600 transition-transform group-open:rotate-90">
          ▸
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-slate-400">{description}</p>
          ) : null}
        </div>
      </summary>
      <div className="mt-3 border-t border-surface-border/60 pt-3">{children}</div>
    </details>
  );
}
