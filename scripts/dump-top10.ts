#!/usr/bin/env npx tsx
/**
 * Print Top 10 boards for a fixture (debug / PR verification).
 *
 * Usage:
 *   npx tsx scripts/dump-top10.ts                    # first upcoming game with predictions
 *   npx tsx scripts/dump-top10.ts --game=123
 *   npx tsx scripts/dump-top10.ts --match="Adelaide,Collingwood"
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, desc, eq, gt, or, sql } from "drizzle-orm";

import { db } from "../src/db";
import { games } from "../src/db/schema";
import { targetLabel } from "../src/lib/format";
import { buildTop10Board } from "../src/lib/predictions/top10Board";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function resolveGameId(): Promise<number | null> {
  const gameArg = arg("game");
  if (gameArg) {
    const id = Number(gameArg);
    return Number.isFinite(id) ? id : null;
  }

  const matchArg = arg("match");
  if (matchArg) {
    const [a, b] = matchArg.split(",").map((s) => s.trim());
    if (a && b) {
      const [row] = await db
        .select({ id: games.id })
        .from(games)
        .where(
          or(
            and(eq(games.home, a), eq(games.away, b)),
            and(eq(games.home, b), eq(games.away, a)),
          ),
        )
        .orderBy(desc(games.commenceTime))
        .limit(1);
      return row?.id ?? null;
    }
  }

  const [row] = await db
    .select({ id: games.id })
    .from(games)
    .where(
      and(
        gt(games.commenceTime, sql`now()`),
        eq(games.status, "scheduled"),
      ),
    )
    .orderBy(games.commenceTime)
    .limit(1);

  return row?.id ?? null;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function main() {
  const gameId = await resolveGameId();
  if (gameId == null) {
    console.error("No game found. Try --game=ID or --match=Home,Away");
    process.exit(1);
  }

  const board = await buildTop10Board(gameId, null);
  console.log(`\nTop 10 boards · game ${gameId} · ${board.home} vs ${board.away}`);
  console.log(`Odds source: ${board.oddsSource}\n`);

  for (const m of board.markets) {
    console.log(`=== ${m.statType.toUpperCase()} ===`);
    for (const side of [m.home, m.away]) {
      console.log(`\n${side.team}:`);
      if (side.rows.length === 0) {
        console.log("  (no lineup / predictions)");
        continue;
      }
      console.log(
        pad("#", 3) +
          pad("Player", 22) +
          pad("Line", 8) +
          pad("Odds", 8) +
          "Reason",
      );
      for (const r of side.rows) {
        console.log(
          pad(String(r.rank), 3) +
            pad(r.playerName, 22) +
            pad(targetLabel(r.line), 8) +
            pad(r.odds != null ? r.odds.toFixed(2) : "—", 8) +
            r.reason,
        );
      }
    }
    console.log("");
  }

  // Assert: elite / high-avg disposal names land on Top 10 when predicted.
  // Catches board-side misses (predict/lineup gaps) — not System diversification.
  if (process.argv.includes("--assert-elite")) {
    let checked = 0;
    let misses = 0;
    for (const m of board.markets) {
      if (m.statType !== "disposals") continue;
      for (const side of [m.home, m.away]) {
        const elites = side.rows.filter(
          (r) =>
            r.benchmark === "elite" ||
            (r.seasonAvg != null && r.seasonAvg >= 25),
        );
        for (const e of elites) {
          checked += 1;
          if (e.rank > 10) {
            misses += 1;
            console.error(
              `ASSERT FAIL: ${e.playerName} (${side.team}) elite/volume Disp not in Top 10`,
            );
          }
        }
        // High season avg among predicted players for this club should be present
        // if they have a Model C row — already filtered into board build.
        const volume = side.rows.filter(
          (r) => r.seasonAvg != null && r.seasonAvg >= 24,
        );
        if (volume.length === 0 && side.rows.length > 0) {
          console.warn(
            `WARN: ${side.team} Disp Top 10 has no 24+ avg — check predictions/features`,
          );
        }
      }
    }
    console.log(
      `\n--assert-elite: ${checked} elite/volume Disp rows on boards, ${misses} misses`,
    );
    if (misses > 0) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
