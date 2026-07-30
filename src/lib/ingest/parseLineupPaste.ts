import type {
  ExtractedLineup,
  ExtractedLineupPlayer,
  LineupStatus,
} from "@/lib/ai/readLineup";
import { normalizeLineupPosition } from "@/lib/ingest/lineupPosition";

const POSITION_HEADER =
  /^(full\s*backs?|half\s*backs?|centres?|center|half\s*forwards?|full\s*forwards?|followers?)$/i;

const SECTION_HEADER = /^(interchanges?|emergencies?)$/i;

const STOP = /^(in|out|omitted|injured|no\s+player|thanks)$/i;

function isJumper(line: string): number | null {
  const n = Number(line);
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  return n;
}

function isPlayerName(line: string): boolean {
  if (POSITION_HEADER.test(line) || SECTION_HEADER.test(line)) return false;
  if (STOP.test(line)) return false;
  if (isJumper(line) != null) return false;
  if (line.length < 2) return false;
  return /[a-zA-Z]/.test(line);
}

function chunkSizeForPosition(header: string): number {
  const h = header.toLowerCase();
  // Match Centre field view: three per team per row (6 names per position block).
  if (/full\s*back/.test(h) || /half\s*back/.test(h)) return 3;
  if (/centre|center/.test(h)) return 3;
  if (/half\s*forward/.test(h) || /full\s*forward/.test(h)) return 3;
  if (/follower/.test(h)) return 3;
  return 3;
}

export type ParsedPastePlayer = ExtractedLineupPlayer & { team: "home" | "away" };

type Draft = ExtractedLineupPlayer;

function flushPairs(
  buffer: Draft[],
  out: ParsedPastePlayer[],
  mode: "pair" | "halves",
) {
  if (buffer.length === 0) return;
  if (mode === "pair") {
    for (let i = 0; i + 1 < buffer.length; i += 2) {
      out.push({ ...buffer[i], team: "away" });
      out.push({ ...buffer[i + 1], team: "home" });
    }
    if (buffer.length % 2 === 1) {
      out.push({ ...buffer[buffer.length - 1], team: "away" });
    }
    buffer.length = 0;
    return;
  }
  const awayCount = Math.ceil(buffer.length / 2);
  buffer.forEach((p, i) => {
    out.push({ ...p, team: i < awayCount ? "away" : "home" });
  });
  buffer.length = 0;
}

/** Match Centre often copies home column, header, away column — not row pairs. */
function looksLikeColumnLayout(lines: string[]): boolean {
  let firstHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (POSITION_HEADER.test(lines[i])) {
      firstHeaderIdx = i;
      break;
    }
  }
  if (firstHeaderIdx <= 0) return false;
  let pairs = 0;
  let pending: number | null = null;
  for (let i = 0; i < firstHeaderIdx; i++) {
    const j = isJumper(lines[i]);
    if (j != null) {
      pending = j;
      continue;
    }
    if (pending != null && isPlayerName(lines[i])) {
      pairs++;
      pending = null;
    }
  }
  return pairs >= 2;
}

function parseLineupPasteColumn(
  lines: string[],
): { players: ParsedPastePlayer[]; skippedLines: string[] } {
  const skippedLines: string[] = [];
  const out: ParsedPastePlayer[] = [];

  let status: LineupStatus = "named";
  let pendingJumper: number | null = null;
  /** Home players listed immediately before the next position header. */
  let homeBeforeHeader: Draft[] = [];
  let awayLeft = 0;
  /** Home names listed right after the away column for the same position group. */
  let homeAfterAwayLeft = 0;
  let fieldPositionLabel: string | null = null;
  let intBuffer: Draft[] = [];

  function emit(p: Draft, team: "home" | "away") {
    out.push({ ...p, team });
  }

  function flushHomeBeforeHeader(position: string | null) {
    if (homeBeforeHeader.length === 0) return;
    for (const p of homeBeforeHeader) {
      emit(
        {
          ...p,
          status: "named",
          position,
        },
        "home",
      );
    }
    homeBeforeHeader = [];
  }

  function flushHomeBeforeSection(asStatus: LineupStatus) {
    for (const p of homeBeforeHeader) {
      emit({ ...p, status: asStatus, position: null }, "home");
    }
    homeBeforeHeader = [];
  }

  function flushIntBuffer() {
    flushPairs(intBuffer, out, "pair");
  }

  for (const line of lines) {
    if (STOP.test(line)) break;

    if (POSITION_HEADER.test(line)) {
      const pos = normalizeLineupPosition(line.replace(/\s+/g, " ").trim());
      const headerRaw = line.replace(/\s+/g, " ").trim();
      if (/follower/i.test(headerRaw)) {
        // Match Centre lists home full forwards immediately above "Followers".
        flushHomeBeforeHeader("FF");
      } else {
        flushHomeBeforeHeader(pos);
      }
      awayLeft = chunkSizeForPosition(line);
      homeAfterAwayLeft = /follower/i.test(headerRaw)
        ? chunkSizeForPosition(line)
        : 0;
      fieldPositionLabel = pos;
      status = "named";
      continue;
    }

    if (SECTION_HEADER.test(line)) {
      flushHomeBeforeSection(status === "named" ? "interchange" : status);
      awayLeft = 0;
      homeAfterAwayLeft = 0;
      fieldPositionLabel = null;
      flushIntBuffer();
      if (/interchange/i.test(line)) status = "interchange";
      else status = "emergency";
      continue;
    }

    const jumper = isJumper(line);
    if (jumper != null) {
      pendingJumper = jumper;
      continue;
    }

    if (pendingJumper != null && isPlayerName(line)) {
      const draft: Draft = {
        name: line.replace(/\s+/g, " ").trim(),
        jumper: pendingJumper,
        position: null,
        status,
      };
      pendingJumper = null;

      if (status === "named" && awayLeft > 0) {
        emit(
          {
            ...draft,
            status: "named",
            position: fieldPositionLabel,
          },
          "away",
        );
        awayLeft--;
        continue;
      }

      if (status === "named" && homeAfterAwayLeft > 0) {
        emit(
          {
            ...draft,
            status: "named",
            position: fieldPositionLabel,
          },
          "home",
        );
        homeAfterAwayLeft--;
        continue;
      }

      if (status === "interchange" || status === "emergency") {
        intBuffer.push({ ...draft, status });
        if (intBuffer.length >= 2) {
          const chunk = intBuffer.splice(0, 2);
          flushPairs(chunk, out, "pair");
        }
        continue;
      }

      homeBeforeHeader.push(draft);
      continue;
    }

    if (isPlayerName(line) && pendingJumper == null) {
      skippedLines.push(line);
    }
  }

  if (status === "interchange" || status === "emergency") {
    flushHomeBeforeSection(status);
  }
  flushIntBuffer();

  return { players: out, skippedLines };
}

/**
 * Row-pair order: header first, then away · home · away · home within each block.
 */
function parseLineupPastePairs(
  lines: string[],
): { players: ParsedPastePlayer[]; skippedLines: string[] } {
  const skippedLines: string[] = [];
  const out: ParsedPastePlayer[] = [];

  let status: LineupStatus = "emergency";
  let pendingJumper: number | null = null;

  let buffer: Draft[] = [];
  let fieldChunkTarget = 0;
  const assignMode: "pair" | "halves" = "pair";
  let fieldPositionLabel: string | null = null;

  function pushPlayer(p: Draft) {
    const withPos =
      status === "named" && fieldPositionLabel
        ? { ...p, position: fieldPositionLabel }
        : p;
    if (status === "named") {
      buffer.push(withPos);
      const need = fieldChunkTarget * 2;
      if (need > 0 && buffer.length >= need) {
        const chunk = buffer.splice(0, need);
        flushPairs(chunk, out, assignMode);
      }
      return;
    }
    if (status === "interchange") {
      buffer.push(p);
      if (buffer.length >= 2) {
        const chunk = buffer.splice(0, 2);
        flushPairs(chunk, out, "pair");
      }
      return;
    }
    buffer.push(p);
    if (buffer.length >= 2) {
      const chunk = buffer.splice(0, 2);
      flushPairs(chunk, out, "pair");
    }
  }

  function flushBuffer() {
    if (buffer.length === 0) return;
    flushPairs(buffer, out, assignMode);
  }

  for (const line of lines) {
    if (STOP.test(line)) break;

    if (POSITION_HEADER.test(line)) {
      flushBuffer();
      status = "named";
      fieldChunkTarget = chunkSizeForPosition(line);
      fieldPositionLabel = normalizeLineupPosition(line.replace(/\s+/g, " ").trim());
      continue;
    }

    if (SECTION_HEADER.test(line)) {
      flushBuffer();
      fieldChunkTarget = 0;
      fieldPositionLabel = null;
      if (/interchange/i.test(line)) status = "interchange";
      else status = "emergency";
      continue;
    }

    const jumper = isJumper(line);
    if (jumper != null) {
      pendingJumper = jumper;
      continue;
    }

    if (pendingJumper != null && isPlayerName(line)) {
      pushPlayer({
        name: line.replace(/\s+/g, " ").trim(),
        jumper: pendingJumper,
        position: null,
        status,
      });
      pendingJumper = null;
      continue;
    }

    if (isPlayerName(line) && pendingJumper == null) {
      skippedLines.push(line);
    }
  }
  flushBuffer();

  return { players: out, skippedLines };
}

/**
 * Parse text copied from AFL Match Centre line-ups (field view). Supports
 * column copy (home block · header · away block) and row-pair copy (away · home
 * per row). Interchange rows are always away · home pairs.
 */
export function parseLineupPaste(
  raw: string,
  _homeTeam: string,
  _awayTeam: string,
): { players: ParsedPastePlayer[]; skippedLines: string[] } {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (looksLikeColumnLayout(lines)) {
    return parseLineupPasteColumn(lines);
  }
  return parseLineupPastePairs(lines);
}

export function pasteToExtractedLineup(
  raw: string,
  homeTeam: string,
  awayTeam: string,
): ExtractedLineup {
  const { players } = parseLineupPaste(raw, homeTeam, awayTeam);
  const homePlayers: ExtractedLineupPlayer[] = [];
  const awayPlayers: ExtractedLineupPlayer[] = [];
  for (const p of players) {
    const { team, ...rest } = p;
    if (team === "home") homePlayers.push(rest);
    else awayPlayers.push(rest);
  }
  return {
    teams: [
      { team: homeTeam, players: homePlayers },
      { team: awayTeam, players: awayPlayers },
    ],
  };
}
