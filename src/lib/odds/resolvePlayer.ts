/**
 * Resolve Odds API / bookie player names → players.id.
 * Same spirit as team-sheet ingest: club + surname (+ initial), nickname map.
 * Never guess on ambiguous surname — return null and keep the raw name.
 */

import { normalisePlayerName } from "@/lib/playerName";

export type PlayerCandidate = {
  id: number;
  name: string;
  team: string | null;
  jumper?: number | null;
};

export type LineupHint = {
  playerName: string;
  team: string;
  jumper: number | null;
  playerId: number | null;
};

const FIRST_NAME_NICKNAMES: Record<string, string[]> = {
  jackson: ["jack"],
  daniel: ["dan", "danny"],
  lachlan: ["lachie", "lachy"],
  joseph: ["joe"],
  mitchell: ["mitch"],
  matthew: ["matt"],
  nicholas: ["nick", "nic"],
  samuel: ["sam"],
  benjamin: ["ben"],
  thomas: ["tom"],
  harrison: ["harry"],
  zachary: ["zac", "zach"],
  maximilian: ["max"],
  cameron: ["cam"],
  anthony: ["tony"],
  michael: ["mick", "mike"],
  patrick: ["paddy", "pat"],
  william: ["will", "billy"],
  joshua: ["josh"],
  christopher: ["chris"],
  timothy: ["tim"],
  dominic: ["dom"],
  oliver: ["ollie"],
  edward: ["ed", "ned"],
  // reverse common short → formal (Odds API often uses formal)
  jack: ["jackson"],
  dan: ["daniel"],
  danny: ["daniel"],
  lachie: ["lachlan"],
  lachy: ["lachlan"],
  joe: ["joseph"],
  mitch: ["mitchell"],
  matt: ["matthew"],
  nick: ["nicholas"],
  nic: ["nicholas"],
  sam: ["samuel"],
  ben: ["benjamin"],
  tom: ["thomas"],
  harry: ["harrison"],
  zac: ["zachary"],
  zach: ["zachary"],
  max: ["maximilian"],
  cam: ["cameron"],
  tony: ["anthony"],
  mick: ["michael"],
  mike: ["michael"],
  pat: ["patrick"],
  paddy: ["patrick"],
  will: ["william"],
  billy: ["william"],
  josh: ["joshua"],
  chris: ["christopher"],
  tim: ["timothy"],
  dom: ["dominic"],
  ollie: ["oliver"],
  ed: ["edward"],
  ned: ["edward"],
};

function surname(name: string): string {
  const parts = normalisePlayerName(name).split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function firstToken(name: string): string {
  const parts = normalisePlayerName(name).split(/\s+/);
  return parts[0] ?? "";
}

function firstInitial(name: string): string {
  const t = firstToken(name);
  return t.charAt(0);
}

function nameVariants(name: string): string[] {
  const n = normalisePlayerName(name);
  const parts = n.split(/\s+/);
  if (parts.length < 2) return [n];
  const first = parts[0]!;
  const rest = parts.slice(1).join(" ");
  const out = new Set<string>([n]);
  for (const alt of FIRST_NAME_NICKNAMES[first] ?? []) {
    out.add(`${alt} ${rest}`);
  }
  return [...out];
}

/**
 * Resolve raw bookmaker name against club roster candidates.
 * `teamHint` = canonical club when known (from fixture sides); if omitted,
 * only unique full-name / nickname matches across the whole candidate list.
 */
export function resolvePlayerId(
  rawName: string,
  candidates: PlayerCandidate[],
  teamHint?: string | null,
): number | null {
  const raw = rawName.trim();
  if (!raw || candidates.length === 0) return null;

  const pool = teamHint
    ? candidates.filter(
        (c) =>
          c.team != null &&
          c.team.toLowerCase() === teamHint.toLowerCase(),
      )
    : candidates;
  const search = pool.length > 0 ? pool : candidates;

  const variants = nameVariants(raw);
  const exact: PlayerCandidate[] = [];
  for (const c of search) {
    const cNorm = normalisePlayerName(c.name);
    if (variants.some((v) => v === cNorm || nameVariants(c.name).includes(v))) {
      exact.push(c);
    }
  }
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) return null; // ambiguous — never wrong-merge

  const sn = surname(raw);
  if (sn.length < 2) return null;
  const parts = normalisePlayerName(raw).split(/\s+/).filter(Boolean);
  const hasFirstAndLast = parts.length >= 2;
  const initial = firstInitial(raw);

  const bySurname = search.filter((c) => surname(c.name) === sn);
  if (bySurname.length === 0) return null;

  // Same club, same surname — require compatible first name (Levi vs Will Ashcroft).
  if (hasFirstAndLast) {
    const byFirst = bySurname.filter((c) => firstNamesCompatible(raw, c.name));
    if (byFirst.length === 1) return byFirst[0]!.id;
    if (byFirst.length > 1) return null;
    return null;
  }

  if (bySurname.length === 1) {
    const only = bySurname[0]!;
    if (teamHint) return only.id;
    return null;
  }

  // Multiple same surname — require matching first initial
  const byInitial = bySurname.filter(
    (c) => firstInitial(c.name) === initial,
  );
  if (byInitial.length === 1) return byInitial[0]!.id;

  // Full first name among surname matches via nickname variants
  if (hasFirstAndLast) {
    const byFirst = bySurname.filter((c) => firstNamesCompatible(raw, c.name));
    if (byFirst.length === 1) return byFirst[0]!.id;
  }

  return null;
}

function firstNamesCompatible(raw: string, candidateName: string): boolean {
  const rFirst = firstToken(raw);
  const cFirst = firstToken(candidateName);
  if (rFirst === cFirst) return true;
  if (rFirst.length === 1 || cFirst.length === 1) {
    return rFirst.charAt(0) === cFirst.charAt(0);
  }
  const rSet = new Set(nameVariants(raw).map((v) => firstToken(v)));
  const cSet = new Set(nameVariants(candidateName).map((v) => firstToken(v)));
  for (const t of rSet) {
    if (cSet.has(t)) return true;
  }
  return false;
}

function lineupNameMatches(raw: string, lineupName: string): boolean {
  const rawV = nameVariants(raw);
  const lpV = nameVariants(lineupName);
  if (rawV.some((v) => lpV.includes(v))) return true;
  if (normalisePlayerName(raw) === normalisePlayerName(lineupName)) return true;
  // Sportsbet / bookies sometimes emit "O'Brien O'Brien" for debuts.
  const rawNorm = normalisePlayerName(raw);
  const lpNorm = normalisePlayerName(lineupName);
  const rawParts = rawNorm.split(/\s+/).filter(Boolean);
  if (
    rawParts.length >= 2 &&
    rawParts.every((p) => p === rawParts[rawParts.length - 1]) &&
    surname(raw) === surname(lineupName)
  ) {
    return true;
  }
  return false;
}

function candidateByTeamJumper(
  candidates: PlayerCandidate[],
  team: string,
  jumper: number,
): number | null {
  const teamL = team.toLowerCase();
  const hits = candidates.filter(
    (c) =>
      c.team != null &&
      c.team.toLowerCase() === teamL &&
      c.jumper === jumper,
  );
  return hits.length === 1 ? hits[0]!.id : null;
}

/**
 * Resolve using bookie name, then this fixture's lineup (name, club, guernsey).
 */
export function resolvePlayerForFixture(
  rawName: string,
  candidates: PlayerCandidate[],
  lineup: LineupHint[],
  homeC: string,
  awayC: string,
): number | null {
  if (lineup.length > 0) {
    for (const lp of lineup) {
      if (!lineupNameMatches(rawName, lp.playerName)) continue;
      if (lp.playerId != null) return lp.playerId;
      if (lp.jumper != null) {
        const id = candidateByTeamJumper(candidates, lp.team, lp.jumper);
        if (id != null) return id;
      }
    }

    const sn = surname(rawName);
    const initial = firstInitial(rawName);
    const bySn = lineup.filter((lp) => surname(lp.playerName) === sn);
    if (bySn.length === 1) {
      const lp = bySn[0]!;
      if (lp.playerId != null) return lp.playerId;
      if (lp.jumper != null) {
        const id = candidateByTeamJumper(candidates, lp.team, lp.jumper);
        if (id != null) return id;
      }
    }

    if (bySn.length > 1) {
      const byInit = bySn.filter((lp) => firstInitial(lp.playerName) === initial);
      const pick = byInit.length === 1 ? byInit[0]! : null;
      if (pick) {
        if (pick.playerId != null) return pick.playerId;
        if (pick.jumper != null) {
          const id = candidateByTeamJumper(candidates, pick.team, pick.jumper);
          if (id != null) return id;
        }
      }
    }
  }

  for (const team of [homeC, awayC, null] as const) {
    const id = resolvePlayerId(rawName, candidates, team);
    if (id != null) return id;
  }

  return null;
}
