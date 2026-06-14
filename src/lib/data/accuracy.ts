import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { modelAccuracy, type ModelKey, type StatType } from "@/db/schema";
import { STAT_TYPES } from "@/lib/predictions/features";

// Aggregate model_accuracy into a leaderboard the Review page can render.

export interface ModelStatScore {
  model: ModelKey;
  statType: StatType;
  mae: number | null;
  lineAccuracy: number | null;
  samples: number;
}

export interface LeaderboardEntry {
  model: ModelKey;
  avgMae: number | null;
  avgLineAccuracy: number | null;
  samples: number;
}

export interface Leaderboard {
  overall: LeaderboardEntry[];
  byStat: ModelStatScore[];
  bestModel: ModelKey | null;
}

const MODELS: ModelKey[] = ["A", "B", "C"];

export async function getLeaderboard(season: number): Promise<Leaderboard> {
  const rows = await db
    .select()
    .from(modelAccuracy)
    .where(eq(modelAccuracy.season, season))
    .orderBy(desc(modelAccuracy.round));

  // Weighted aggregation by sample size.
  const byStat: ModelStatScore[] = [];
  const overallAcc = new Map<ModelKey, { maeW: number; accW: number; n: number; accN: number }>();

  for (const model of MODELS) {
    for (const stat of STAT_TYPES) {
      const subset = rows.filter((r) => r.model === model && r.statType === stat);
      const samples = subset.reduce((a, r) => a + (r.sampleSize ?? 0), 0);
      if (samples === 0) {
        byStat.push({ model, statType: stat, mae: null, lineAccuracy: null, samples: 0 });
        continue;
      }
      const maeW =
        subset.reduce((a, r) => a + (r.mae ?? 0) * (r.sampleSize ?? 0), 0) / samples;
      const accSubset = subset.filter((r) => r.accuracy != null);
      const accSamples = accSubset.reduce((a, r) => a + (r.sampleSize ?? 0), 0);
      const accW =
        accSamples > 0
          ? accSubset.reduce((a, r) => a + (r.accuracy ?? 0) * (r.sampleSize ?? 0), 0) /
            accSamples
          : null;
      byStat.push({ model, statType: stat, mae: maeW, lineAccuracy: accW, samples });

      const agg = overallAcc.get(model) ?? { maeW: 0, accW: 0, n: 0, accN: 0 };
      agg.maeW += maeW * samples;
      agg.n += samples;
      if (accW != null) {
        agg.accW += accW * accSamples;
        agg.accN += accSamples;
      }
      overallAcc.set(model, agg);
    }
  }

  const overall: LeaderboardEntry[] = MODELS.map((model) => {
    const agg = overallAcc.get(model);
    return {
      model,
      avgMae: agg && agg.n > 0 ? agg.maeW / agg.n : null,
      avgLineAccuracy: agg && agg.accN > 0 ? agg.accW / agg.accN : null,
      samples: agg?.n ?? 0,
    };
  });

  // Best model = lowest average MAE among those with samples.
  const scored = overall.filter((o) => o.avgMae != null);
  const bestModel =
    scored.length > 0
      ? scored.reduce((best, o) => (o.avgMae! < best.avgMae! ? o : best)).model
      : null;

  return { overall, byStat, bestModel };
}
