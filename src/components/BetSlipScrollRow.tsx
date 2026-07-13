"use client";

import type { ReactNode } from "react";

/** Horizontal row with the scrollbar along the top edge (below the round heading). */
export function BetSlipScrollRow({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-x-top -mx-1 px-1">
      <div className="flex snap-x snap-mandatory gap-3 pb-2">{children}</div>
    </div>
  );
}
