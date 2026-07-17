"use client";

import { useState } from "react";

import { StrategyLabPanel } from "@/components/StrategyLabPanel";
import type { BacktestLabData } from "@/lib/data/backtest";
import type { BankrollSimView } from "@/lib/system/bankroll";
import {
  DEFAULT_LAB_CONTROLS,
  type LabControlFilters,
} from "@/lib/system/labFilters";

/** Dials → live matchup / dollar dashboard → deep charts. */
export function LabWorkspace({
  labData,
  bankroll,
}: {
  labData: BacktestLabData;
  bankroll: BankrollSimView;
}) {
  const [controls, setControls] = useState<LabControlFilters>({
    runId: labData.run?.id ?? bankroll.run?.sourceRunId ?? null,
    ...DEFAULT_LAB_CONTROLS,
  });

  return (
    <StrategyLabPanel
      data={labData}
      bankroll={bankroll}
      controls={controls}
      onControlsChange={setControls}
    />
  );
}
