/**
 * Normalise Odds API event-odds bookmaker outcomes into O/U snapshot rows.
 *
 * AFL player props typically look like:
 *   { name: "Over", description: "Nick Daicos", price: 1.85, point: 29.5 }
 *   { name: "Under", description: "Nick Daicos", price: 1.95, point: 29.5 }
 * Over-only markets may omit Under, or use the player as `name` with `point`.
 */

import { mapMarketToStatFamily } from "@/lib/odds/markets";

export type ParsedPropRow = {
  playerName: string;
  marketKey: string;
  statFamily: string | null;
  line: number;
  overOdds: number | null;
  underOdds: number | null;
  bookmaker: string;
};

type Outcome = {
  name?: string;
  description?: string | null;
  price?: number;
  point?: number | null;
};

type Market = {
  key?: string;
  outcomes?: Outcome[];
};

type Bookmaker = {
  key?: string;
  title?: string;
  markets?: Market[];
};

function isOverName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "over" || n === "yes";
}

function isUnderName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "under" || n === "no";
}

/**
 * Collapse bookmaker markets into one row per player×line×bookmaker×market
 * (over/under prices paired when both present).
 */
export function parseBookmakerProps(
  bookmakers: Bookmaker[],
  marketKeys: Set<string>,
): ParsedPropRow[] {
  type Acc = {
    playerName: string;
    marketKey: string;
    line: number;
    bookmaker: string;
    overOdds: number | null;
    underOdds: number | null;
  };
  const map = new Map<string, Acc>();

  for (const bk of bookmakers) {
    const bookmaker = (bk.key ?? bk.title ?? "unknown").toLowerCase();
    for (const m of bk.markets ?? []) {
      const marketKey = m.key ?? "";
      if (!marketKeys.has(marketKey)) continue;

      for (const o of m.outcomes ?? []) {
        const price = o.price;
        if (price == null || !Number.isFinite(price)) continue;
        const point = o.point;
        const name = (o.name ?? "").trim();
        const desc = (o.description ?? "").trim();

        let playerName: string;
        let side: "over" | "under" | "unknown";

        if (isOverName(name) || isUnderName(name)) {
          playerName = desc || name;
          side = isOverName(name) ? "over" : "under";
        } else if (desc && (isOverName(desc) || isUnderName(desc))) {
          playerName = name;
          side = isOverName(desc) ? "over" : "under";
        } else {
          // Over-only: player in name, point is the line
          playerName = desc || name;
          side = "over";
        }

        if (!playerName || playerName.toLowerCase() === "over" || playerName.toLowerCase() === "under") {
          continue;
        }
        if (point == null || !Number.isFinite(point)) continue;

        const key = `${bookmaker}|${marketKey}|${playerName.toLowerCase()}|${point}`;
        const acc =
          map.get(key) ??
          ({
            playerName,
            marketKey,
            line: point,
            bookmaker,
            overOdds: null,
            underOdds: null,
          } satisfies Acc);

        if (side === "under") acc.underOdds = price;
        else acc.overOdds = price;
        map.set(key, acc);
      }
    }
  }

  return [...map.values()].map((r) => ({
    ...r,
    statFamily: mapMarketToStatFamily(r.marketKey),
  }));
}
