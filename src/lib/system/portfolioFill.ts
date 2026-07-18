/**
 * Anti-Daicos-everywhere portfolio fill (LOCKED plan in HANDOFF.md).
 * Pure / unit-testable — no DB. Greedy vs snake-draft comparison for backtest.
 */

import type { StatType } from "@/db/schema";

export type StatFamily =
  | "disposals"
  | "marks"
  | "tackles"
  | "goals"
  | "kicks"
  | "handballs";

export type FillCandidate = {
  playerId: number;
  playerName: string;
  team: string;
  /** Market on the leg (may be any). */
  statType: StatType | "any";
  /** Family used for exposure / core exclusivity. */
  statFamily: StatFamily;
  line: number;
  prediction: number;
  odds?: number | null;
  /** Model clear probability 0..1 (before personal tape soft-score). */
  confidence: number;
  /** Pre-assembled soft score (confidence×100 + band + tilt + tape ±10). */
  softScore: number;
  historyHits?: number;
  historyBets?: number;
};

/** Leaders band → soft-score points (separate from confidence mult in suggest). */
export function bandSoftBonus(
  band: "elite" | "above" | "average" | "below" | "unknown" | null | undefined,
): number {
  switch (band) {
    case "elite":
      return 8;
    case "above":
      return 4;
    case "average":
      return 0;
    case "below":
      return -8;
    default:
      return -2;
  }
}

export type TicketSlot = {
  id: string;
  strategyKey: string;
  focus: string;
  legCount: number;
  isFun?: boolean;
};

export type FilledTicket = {
  slotId: string;
  strategyKey: string;
  isFun: boolean;
  legs: FillCandidate[];
};

export type PortfolioMetrics = {
  effectiveIndependentBets: number;
  maxAppearances: number;
  bookLeanPct: number;
  bookLeanClub: string | null;
  bookLeanWarning: string | null;
  ticketCount: number;
  avgPairwiseOverlap: number;
};

export type FillOptions = {
  /** Quadratic penalty λ on appearances² (default 8). */
  lambda?: number;
  hardWall?: number;
  teamCapPct?: number;
  bookLeanWarnPct?: number;
  coreMax?: number;
  coreFloorShrunk?: number;
  baselineHit?: number;
};

export type FillResult = {
  tickets: FilledTicket[];
  cores: { playerId: number; family: StatFamily; playerName: string }[];
  metrics: PortfolioMetrics;
};

const DEFAULTS = {
  /** Tuned by docs/portfolio-fill-backtest.md λ sweep (recommend 4). */
  lambda: 4,
  hardWall: 3,
  teamCapPct: 0.5,
  bookLeanWarnPct: 0.6,
  coreMax: 2,
  coreFloorShrunk: 0.6,
  baselineHit: 0.65,
};

/** Map leg stat (incl. any) → exposure family. */
export function resolveStatFamily(
  statType: StatType | "any",
  /** When focus/ticket is Any, use this as the family the model rides on. */
  dominantForAny?: StatType | null,
): StatFamily {
  if (statType === "any") {
    return (dominantForAny ?? "disposals") as StatFamily;
  }
  return statType as StatFamily;
}

export function exposureKey(playerId: number, family: StatFamily): string {
  return `${playerId}:${family}`;
}

/**
 * Bayesian shrinkage toward prior.
 * Default prior ≈ 10 legs @ 65% → priorHits=6.5, priorN=10.
 * Pins: 0/2 → ~54%, 6/7 → ~74%, 0/1 → ~59%.
 */
export function shrunkRate(
  hits: number,
  n: number,
  priorHits = 6.5,
  priorN = 10,
): number {
  if (n < 0 || hits < 0 || hits > n) {
    throw new Error(`invalid hits/n: ${hits}/${n}`);
  }
  return (hits + priorHits) / (n + priorN);
}

/** Map shrunk rate vs baseline into ±maxPoints soft-score modifier. */
export function tapeModifier(
  shrunk: number,
  baseline = 0.65,
  maxPoints = 10,
): number {
  // ±0.20 rate ≈ full ±10 points
  const raw = ((shrunk - baseline) / 0.2) * maxPoints;
  return Math.max(-maxPoints, Math.min(maxPoints, raw));
}

export function assembleSoftScore(opts: {
  confidence: number;
  bandBonus?: number;
  labTilt?: number;
  historyHits?: number;
  historyBets?: number;
  baselineHit?: number;
}): number {
  const baseline = opts.baselineHit ?? DEFAULTS.baselineHit;
  const confPts = opts.confidence * 100;
  const band = opts.bandBonus ?? 0;
  const tilt = opts.labTilt ?? 0;
  let tape = 0;
  if (opts.historyBets != null && opts.historyBets > 0) {
    const s = shrunkRate(opts.historyHits ?? 0, opts.historyBets);
    tape = tapeModifier(s, baseline, 10);
  }
  return confPts + band + tilt + tape;
}

/**
 * Team share cap vs the *target* ticket size.
 * Using share-of-legs-so-far breaks odd counts: after Haw+Rich on a 3-leg,
 * any third pick is 2/3 ≈ 67% > 50% and the ticket stalls at 2 forever.
 * Allow up to ceil(target × cap) from one club (3 @ 50% → 2).
 */
function wouldBreachTeamCap(
  legs: FillCandidate[],
  next: FillCandidate,
  cap: number,
  targetLegCount: number,
): boolean {
  if (legs.length === 0) return false;
  const maxAllowed = Math.max(1, Math.ceil(targetLegCount * cap));
  const nextCount =
    legs.filter((l) => l.team === next.team).length + 1;
  return nextCount > maxAllowed;
}

/** Avg pairwise Jaccard overlap of exposure-key sets across tickets. */
export function avgPairwiseOverlap(tickets: FilledTicket[]): number {
  const sets = tickets
    .filter((t) => !t.isFun && t.legs.length > 0)
    .map(
      (t) =>
        new Set(
          t.legs.map((l) => exposureKey(l.playerId, l.statFamily)),
        ),
    );
  if (sets.length < 2) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i]!;
      const b = sets[j]!;
      let inter = 0;
      for (const k of a) if (b.has(k)) inter++;
      const union = a.size + b.size - inter;
      sum += union === 0 ? 0 : inter / union;
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

export function computeMetrics(tickets: FilledTicket[]): PortfolioMetrics {
  const nonFun = tickets.filter((t) => !t.isFun);
  const overlap = avgPairwiseOverlap(tickets);
  const ticketCount = nonFun.length;
  const effectiveIndependentBets =
    ticketCount * (1 - overlap);

  const counts = new Map<string, number>();
  for (const t of nonFun) {
    for (const l of t.legs) {
      const k = exposureKey(l.playerId, l.statFamily);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  let maxAppearances = 0;
  for (const c of counts.values()) maxAppearances = Math.max(maxAppearances, c);

  const clubLegs = new Map<string, number>();
  let total = 0;
  for (const t of nonFun) {
    for (const l of t.legs) {
      clubLegs.set(l.team, (clubLegs.get(l.team) ?? 0) + 1);
      total++;
    }
  }
  let bookLeanClub: string | null = null;
  let bookLeanPct = 0;
  for (const [club, n] of clubLegs) {
    const pct = total > 0 ? n / total : 0;
    if (pct > bookLeanPct) {
      bookLeanPct = pct;
      bookLeanClub = club;
    }
  }
  const warn =
    bookLeanPct >= DEFAULTS.bookLeanWarnPct && bookLeanClub
      ? `Book lean: ${Math.round(bookLeanPct * 100)}% ${bookLeanClub}`
      : null;

  return {
    effectiveIndependentBets:
      Math.round(effectiveIndependentBets * 100) / 100,
    maxAppearances,
    bookLeanPct: Math.round(bookLeanPct * 1000) / 10,
    bookLeanClub,
    bookLeanWarning: warn,
    ticketCount,
    avgPairwiseOverlap: Math.round(overlap * 1000) / 1000,
  };
}

function pickCores(
  pool: FillCandidate[],
  opts: Required<typeof DEFAULTS>,
): { playerId: number; family: StatFamily; playerName: string }[] {
  const ranked = [...pool].sort((a, b) => b.softScore - a.softScore);
  const cores: { playerId: number; family: StatFamily; playerName: string }[] =
    [];
  const usedFamilies = new Set<StatFamily>();

  for (const c of ranked) {
    if (cores.length >= opts.coreMax) break;
    if (usedFamilies.has(c.statFamily)) continue;
    const n = c.historyBets ?? 0;
    const hits = c.historyHits ?? 0;
    const shrunk = n > 0 ? shrunkRate(hits, n) : opts.baselineHit;
    if (shrunk < opts.coreFloorShrunk) continue;
    cores.push({
      playerId: c.playerId,
      family: c.statFamily,
      playerName: c.playerName,
    });
    usedFamilies.add(c.statFamily);
  }
  return cores;
}

function isCore(
  c: FillCandidate,
  cores: { playerId: number; family: StatFamily }[],
): boolean {
  return cores.some(
    (x) => x.playerId === c.playerId && x.family === c.statFamily,
  );
}

function coreAppearances(
  tickets: FilledTicket[],
  core: { playerId: number; family: StatFamily },
): number {
  let n = 0;
  for (const t of tickets) {
    if (t.isFun) continue;
    if (
      t.legs.some(
        (l) =>
          l.playerId === core.playerId && l.statFamily === core.family,
      )
    ) {
      n++;
    }
  }
  return n;
}

/** Per-ticket greedy fill (legacy) — ignores cross-ticket state. */
export function fillGreedy(
  slots: TicketSlot[],
  pool: FillCandidate[],
): FillResult {
  const tickets: FilledTicket[] = [];
  for (const slot of slots) {
    const focusFamily =
      slot.focus === "any"
        ? null
        : resolveStatFamily(slot.focus as StatType);
    let ranked = [...pool].sort((a, b) => b.softScore - a.softScore);
    if (focusFamily) {
      const focused = ranked.filter((c) => c.statFamily === focusFamily);
      if (focused.length >= slot.legCount) ranked = focused;
    }
    const legs: FillCandidate[] = [];
    const usedPlayers = new Set<number>();
    for (const c of ranked) {
      if (legs.length >= slot.legCount) break;
      if (usedPlayers.has(c.playerId)) continue;
      if (wouldBreachTeamCap(legs, c, DEFAULTS.teamCapPct, slot.legCount)) {
        continue;
      }
      legs.push(c);
      usedPlayers.add(c.playerId);
    }
    tickets.push({
      slotId: slot.id,
      strategyKey: slot.strategyKey,
      isFun: !!slot.isFun,
      legs,
    });
  }
  return { tickets, cores: [], metrics: computeMetrics(tickets) };
}

/**
 * Snake-draft fill across non-FUN tickets, then FUN from leftovers (core-free).
 */
export function fillSnakeDraft(
  slots: TicketSlot[],
  pool: FillCandidate[],
  options: FillOptions = {},
): FillResult {
  const opts = { ...DEFAULTS, ...options };
  const nonFunSlots = slots.filter((s) => !s.isFun);
  const funSlots = slots.filter((s) => s.isFun);

  const cores = pickCores(pool, opts);
  const coreCap = Math.max(1, Math.floor(nonFunSlots.length / 2));

  const tickets: FilledTicket[] = nonFunSlots.map((s) => ({
    slotId: s.id,
    strategyKey: s.strategyKey,
    isFun: false,
    legs: [] as FillCandidate[],
  }));

  const appearances = new Map<string, number>();
  const need = nonFunSlots.map((s) => s.legCount);
  const totalNeed = need.reduce((a, b) => a + b, 0);

  // Snake order: 0,1,2,...,n-1,n-1,...,1,0,...
  const order: number[] = [];
  let forward = true;
  while (order.length < totalNeed) {
    if (forward) {
      for (let i = 0; i < tickets.length; i++) order.push(i);
    } else {
      for (let i = tickets.length - 1; i >= 0; i--) order.push(i);
    }
    forward = !forward;
  }

  const usedOnTicket = tickets.map(() => new Set<number>());

  for (const ti of order) {
    const ticket = tickets[ti]!;
    const slot = nonFunSlots[ti]!;
    if (ticket.legs.length >= slot.legCount) continue;

    const focusFamily =
      slot.focus === "any"
        ? null
        : resolveStatFamily(slot.focus as StatType);

    let best: FillCandidate | null = null;
    let bestScore = -Infinity;

    for (const c of pool) {
      if (usedOnTicket[ti]!.has(c.playerId)) continue;
      if (focusFamily && c.statFamily !== focusFamily) continue;

      const key = exposureKey(c.playerId, c.statFamily);
      const apps = appearances.get(key) ?? 0;
      if (apps >= opts.hardWall) continue;

      const core = isCore(c, cores);
      if (
        core &&
        coreAppearances(tickets, {
          playerId: c.playerId,
          family: c.statFamily,
        }) >= coreCap
      ) {
        continue;
      }

      if (
        wouldBreachTeamCap(ticket.legs, c, opts.teamCapPct, slot.legCount)
      ) {
        continue;
      }

      const penalised = c.softScore - opts.lambda * apps * apps;
      if (penalised > bestScore) {
        bestScore = penalised;
        best = c;
      }
    }

    if (!best) {
      // Relax focus filter once if stuck
      for (const c of pool) {
        if (usedOnTicket[ti]!.has(c.playerId)) continue;
        const key = exposureKey(c.playerId, c.statFamily);
        const apps = appearances.get(key) ?? 0;
        if (apps >= opts.hardWall) continue;
        if (
          wouldBreachTeamCap(ticket.legs, c, opts.teamCapPct, slot.legCount)
        ) {
          continue;
        }
        const penalised = c.softScore - opts.lambda * apps * apps;
        if (penalised > bestScore) {
          bestScore = penalised;
          best = c;
        }
      }
    }

    if (!best) continue;

    ticket.legs.push(best);
    usedOnTicket[ti]!.add(best.playerId);
    const key = exposureKey(best.playerId, best.statFamily);
    appearances.set(key, (appearances.get(key) ?? 0) + 1);
  }

  // Top-up pass: finish underfilled tickets from focus pool (same caps).
  for (let ti = 0; ti < tickets.length; ti++) {
    const ticket = tickets[ti]!;
    const slot = nonFunSlots[ti]!;
    while (ticket.legs.length < slot.legCount) {
      const focusFamily =
        slot.focus === "any"
          ? null
          : resolveStatFamily(slot.focus as StatType);
      let best: FillCandidate | null = null;
      let bestScore = -Infinity;
      for (const c of pool) {
        if (usedOnTicket[ti]!.has(c.playerId)) continue;
        if (focusFamily && c.statFamily !== focusFamily) continue;
        const key = exposureKey(c.playerId, c.statFamily);
        const apps = appearances.get(key) ?? 0;
        if (apps >= opts.hardWall) continue;
        if (
          wouldBreachTeamCap(ticket.legs, c, opts.teamCapPct, slot.legCount)
        ) {
          continue;
        }
        const penalised = c.softScore - opts.lambda * apps * apps;
        if (penalised > bestScore) {
          bestScore = penalised;
          best = c;
        }
      }
      if (!best) break;
      ticket.legs.push(best);
      usedOnTicket[ti]!.add(best.playerId);
      const key = exposureKey(best.playerId, best.statFamily);
      appearances.set(key, (appearances.get(key) ?? 0) + 1);
    }
  }

  // FUN: core-free, prefer high-model players the draft passed over
  const usedKeys = new Set<string>();
  for (const t of tickets) {
    for (const l of t.legs) {
      usedKeys.add(exposureKey(l.playerId, l.statFamily));
    }
  }
  const coreKeys = new Set(
    cores.map((c) => exposureKey(c.playerId, c.family)),
  );

  for (const slot of funSlots) {
    const passedOver = pool
      .filter((c) => {
        const k = exposureKey(c.playerId, c.statFamily);
        if (coreKeys.has(k)) return false;
        return true;
      })
      .sort((a, b) => {
        const aUsed = usedKeys.has(exposureKey(a.playerId, a.statFamily))
          ? 0
          : 1;
        const bUsed = usedKeys.has(exposureKey(b.playerId, b.statFamily))
          ? 0
          : 1;
        // Prefer draft-passed-over (not used), then confidence
        return bUsed - aUsed || b.confidence - a.confidence;
      });

    const legs: FillCandidate[] = [];
    const usedPlayers = new Set<number>();
    for (const c of passedOver) {
      if (legs.length >= slot.legCount) break;
      if (usedPlayers.has(c.playerId)) continue;
      if (coreKeys.has(exposureKey(c.playerId, c.statFamily))) continue;
      legs.push(c);
      usedPlayers.add(c.playerId);
    }
    tickets.push({
      slotId: slot.id,
      strategyKey: slot.strategyKey,
      isFun: true,
      legs,
    });
  }

  const metrics = computeMetrics(tickets);
  if (
    metrics.bookLeanPct / 100 >= opts.bookLeanWarnPct &&
    metrics.bookLeanClub
  ) {
    metrics.bookLeanWarning = `Book lean: ${Math.round(metrics.bookLeanPct)}% ${metrics.bookLeanClub}`;
  }

  return { tickets, cores, metrics };
}

/**
 * Env flag — ON by default after backtest review (July 2026).
 * Set PORTFOLIO_DRAFT_FILL=off to revert to per-ticket greedy fill.
 */
export function isPortfolioDraftFillEnabled(): boolean {
  const v = process.env.PORTFOLIO_DRAFT_FILL?.trim().toLowerCase();
  if (v === undefined || v === "") return true;
  return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}
