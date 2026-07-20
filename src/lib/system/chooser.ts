/**
 * System book 3-card chooser — three coherent portfolios per refresh:
 *   edge  (green)  — model% vs bookie, cushion
 *   hot   (orange) — last-game leaders + last-5 form
 *   spread (sky)   — diversify hard (high λ, satellite-1)
 */

import type { StatType } from "@/db/schema";
import type { BenchmarkBand } from "@/lib/data/leaders";
import {
  assembleSoftScore,
  bandSoftBonus,
  edgePackageFillOptions,
} from "@/lib/system/portfolioFill";
import type {
  FillCandidate,
  FillResult,
  FilledTicket,
  PortfolioMetrics,
} from "@/lib/system/portfolioFill";
import { runPortfolioFillExplicit } from "@/lib/system/portfolioFillBridge";

export type CardStyle = "edge" | "hot" | "spread";

export const CARD_STYLES: CardStyle[] = ["edge", "hot", "spread"];

export type ChooserLeg = {
  playerId: number;
  playerName: string;
  team: string;
  statType: StatType | "any";
  line: number;
  prediction: number;
  confidence: number;
  benchmark?: BenchmarkBand | "unknown" | null;
  edge?: number | null;
  leaderRank?: number | null;
  leaderLastValue?: number | null;
};

export type ChooserCard = {
  style: CardStyle;
  /** Short label on the card. */
  title: string;
  /** One-line why this style picked these legs. */
  why: string;
  colour: "green" | "orange" | "sky";
  modelledChance: number | null;
  estOdds: number | null;
  legs: ChooserLeg[];
  /** Players also on another style's card for this slot. */
  sharedNames: string[];
};

export type ChooserSlot = {
  strategyKey: string;
  label: string;
  focus: string;
  legCount: number;
  tier: string;
  cards: ChooserCard[];
};

export type ChooserBook = {
  slots: ChooserSlot[];
  metricsByStyle: Record<CardStyle, PortfolioMetrics>;
};

const META: Record<
  CardStyle,
  { title: string; why: string; colour: "green" | "orange" | "sky" }
> = {
  edge: {
    title: "Best edge",
    why: "Ranks by model% vs bookie implied% + line cushion (avoids taxed shorts).",
    colour: "green",
  },
  hot: {
    title: "Last-week hot",
    why: "Boosts players who led goals/disposals/marks/tackles last game + rising form.",
    colour: "orange",
  },
  spread: {
    title: "Spread book",
    why: "Hard diversification — satellite once, strong appearance penalty, fewer clones.",
    colour: "sky",
  },
};

function modelStats(legs: FillCandidate[]): {
  combinedChance: number | null;
  estOdds: number | null;
} {
  if (legs.length === 0) return { combinedChance: null, estOdds: null };
  let chance = 1;
  for (const l of legs) {
    chance *= Math.max(0.02, Math.min(0.98, l.confidence));
  }
  const estOdds = chance > 0 ? Math.round((1 / chance) * 100) / 100 : null;
  return {
    combinedChance: Math.round(chance * 1000) / 1000,
    estOdds,
  };
}

/** Re-score a pool for a chooser style (keeps edge metadata on candidates). */
export function reweightPoolForStyle(
  pool: FillCandidate[],
  style: CardStyle,
): FillCandidate[] {
  return pool.map((c) => {
    const band = bandSoftBonus(c.band);
    const edgePts = c.edgePts ?? 0;
    const cushionPts = c.cushionPts ?? 0;
    const trendPts = c.trendPts ?? 0;
    const leaderPts = c.leaderPts ?? 0;
    let packagePts = 0;
    let confScale = 1;
    if (style === "edge") {
      packagePts = edgePts * 1.8 + cushionPts * 1.2 + trendPts * 0.5 + leaderPts * 0.4;
    } else if (style === "hot") {
      packagePts = leaderPts * 4 + trendPts * 2.5 + cushionPts * 0.5 + edgePts * 0.3;
      confScale = 0.85;
    } else {
      // spread: flatten elites slightly; prefer unused names via fill λ later
      packagePts = edgePts * 0.6 + cushionPts + trendPts * 0.8 + leaderPts * 0.5;
      confScale = 0.95;
    }
    const softScore = assembleSoftScore({
      confidence: c.confidence * confScale,
      bandBonus: band,
      historyHits: c.historyHits,
      historyBets: c.historyBets,
      edgePackagePts: packagePts,
    });
    return { ...c, softScore };
  });
}

function fillOptsForStyle(style: CardStyle) {
  if (style === "spread") {
    return edgePackageFillOptions({ lambda: 14, hardWall: 3 });
  }
  if (style === "hot") {
    return edgePackageFillOptions({ lambda: 3, hardWall: 3 });
  }
  return edgePackageFillOptions({ lambda: 4, hardWall: 3 });
}

function ticketByKey(
  result: FillResult,
  strategyKey: string,
): FilledTicket | undefined {
  return result.tickets.find((t) => t.strategyKey === strategyKey);
}

function toChooserLeg(l: FillCandidate): ChooserLeg {
  return {
    playerId: l.playerId,
    playerName: l.playerName,
    team: l.team,
    statType: l.statType,
    line: l.line,
    prediction: l.prediction,
    confidence: l.confidence,
    benchmark: l.band ?? null,
    edge: l.edge ?? null,
    leaderRank: l.leaderRank ?? null,
    leaderLastValue: l.leaderLastValue ?? null,
  };
}

function computeShared(
  legsByStyle: Record<CardStyle, ChooserLeg[]>,
): Record<CardStyle, string[]> {
  const out: Record<CardStyle, string[]> = {
    edge: [],
    hot: [],
    spread: [],
  };
  for (const style of CARD_STYLES) {
    const mine = new Set(legsByStyle[style].map((l) => l.playerName));
    const others = new Set<string>();
    for (const other of CARD_STYLES) {
      if (other === style) continue;
      for (const l of legsByStyle[other]) others.add(l.playerName);
    }
    out[style] = [...mine].filter((n) => others.has(n)).sort();
  }
  return out;
}

/**
 * Build three full portfolio fills from the same slots + edge-enriched pool.
 */
export function buildChooserBook(
  slots: {
    id: string;
    strategyKey: string;
    focus: string;
    legCount: number;
    isFun?: boolean;
  }[],
  pool: FillCandidate[],
  meta: {
    labelFor: (strategyKey: string, legCount: number) => string;
    tierFor: (strategyKey: string, isFun: boolean) => string;
  },
): ChooserBook {
  const books = {} as Record<CardStyle, FillResult>;
  for (const style of CARD_STYLES) {
    const weighted = reweightPoolForStyle(pool, style);
    books[style] = runPortfolioFillExplicit(
      slots,
      weighted,
      "draft",
      fillOptsForStyle(style),
    );
  }

  // Preserve slot order
  const orderedKeys = slots.map((s) => s.strategyKey);

  const chooserSlots: ChooserSlot[] = [];
  for (const strategyKey of orderedKeys) {
    const slot = slots.find((s) => s.strategyKey === strategyKey)!;
    const legsByStyle = {} as Record<CardStyle, ChooserLeg[]>;
    for (const style of CARD_STYLES) {
      const t = ticketByKey(books[style], strategyKey);
      legsByStyle[style] = (t?.legs ?? []).map(toChooserLeg);
    }
    const shared = computeShared(legsByStyle);
    const cards: ChooserCard[] = CARD_STYLES.map((style) => {
      const t = ticketByKey(books[style], strategyKey);
      const legs = legsByStyle[style];
      const { combinedChance, estOdds } = modelStats(t?.legs ?? []);
      const m = META[style];
      return {
        style,
        title: m.title,
        why: m.why,
        colour: m.colour,
        modelledChance: combinedChance,
        estOdds,
        legs,
        sharedNames: shared[style],
      };
    });

    chooserSlots.push({
      strategyKey,
      label: meta.labelFor(strategyKey, cards[0]?.legs.length || slot.legCount),
      focus: slot.focus,
      legCount: slot.legCount,
      tier: meta.tierFor(strategyKey, !!slot.isFun),
      cards,
    });
  }

  return {
    slots: chooserSlots,
    metricsByStyle: {
      edge: books.edge.metrics,
      hot: books.hot.metrics,
      spread: books.spread.metrics,
    },
  };
}

/** Pick one card per slot → flat ticket list for persistence. */
export function materialiseSelections(
  chooser: ChooserBook,
  selections: Record<string, CardStyle>,
): {
  strategyKey: string;
  focus: string;
  tier: string;
  label: string;
  modelledChance: number | null;
  estOdds: number | null;
  legs: ChooserLeg[];
  style: CardStyle;
}[] {
  return chooser.slots
    .map((slot) => {
      const style = selections[slot.strategyKey] ?? "edge";
      const card = slot.cards.find((c) => c.style === style) ?? slot.cards[0]!;
      if (card.legs.length === 0) return null;
      return {
        strategyKey: slot.strategyKey,
        focus: slot.focus,
        tier: slot.tier,
        label: slot.label.replace(
          /\d+\s*legs?/i,
          `${card.legs.length} legs`,
        ),
        modelledChance: card.modelledChance,
        estOdds: card.estOdds,
        legs: card.legs,
        style,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t != null);
}
