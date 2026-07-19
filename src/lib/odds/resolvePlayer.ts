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
  const initial = firstInitial(raw);
  const hasFirst = firstToken(raw).length > 1; // "N Daicos" vs "Nick Daicos"

  const bySurname = search.filter((c) => surname(c.name) === sn);
  if (bySurname.length === 0) return null;
  if (bySurname.length === 1) {
    // Only accept sole surname match when we have a team hint (club+surname)
    // or the raw name is a full first+last that already failed exact (rare).
    if (teamHint) return bySurname[0]!.id;
    return null;
  }

  // Multiple same surname — require matching first initial
  const byInitial = bySurname.filter(
    (c) => firstInitial(c.name) === initial,
  );
  if (byInitial.length === 1) return byInitial[0]!.id;

  // Full first name among surname matches via nickname variants
  if (hasFirst) {
    const byFirst = bySurname.filter((c) => {
      const cFirst = firstToken(c.name);
      return (
        variants.some((v) => firstToken(v) === cFirst) ||
        nameVariants(c.name).some((v) => firstToken(v) === firstToken(raw))
      );
    });
    if (byFirst.length === 1) return byFirst[0]!.id;
  }

  return null;
}
