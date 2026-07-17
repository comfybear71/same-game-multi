import { env } from "@/lib/env";

// Read an AFL team-sheet / Line-Ups screenshot (AFL app or afl.com.au Match
// Centre) with Claude vision and return the named squad per club. This is the
// free replacement for the paid Odds API's "who's playing" list: the names it
// returns seed prediction generation, which then pulls each player's real stats
// from AFL Tables. Uses the Anthropic Messages API directly (no SDK dependency),
// matching src/lib/ai/readBetSlip.ts.

// Vision-capable. The team sheet interleaves both clubs and shows initials
// rather than full first names, so we lean on the model's AFL knowledge to
// expand names — use a capable model, not the cheapest.
const MODEL = "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";

const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export type LineupStatus = "named" | "interchange" | "emergency";

export interface ExtractedLineupPlayer {
  name: string; // full name where the model can resolve it (e.g. "Callum Wilkie")
  jumper: number | null;
  position: string | null; // e.g. "Half Back", "Followers"; null off the field
  status: LineupStatus;
}

export interface ExtractedLineupTeam {
  team: string; // club name as shown / matched to one of the two given clubs
  players: ExtractedLineupPlayer[];
}

export interface ExtractedLineup {
  teams: ExtractedLineupTeam[];
}

export interface LineupImage {
  data: string; // base64 (no data: prefix)
  mediaType: string;
}

function buildPrompt(homeTeam: string | null, awayTeam: string | null): string {
  const matchLine =
    homeTeam && awayTeam
      ? `This screenshot is the team sheet for the AFL match ${homeTeam} vs ${awayTeam}. Every player belongs to one of those two clubs — assign each to "${homeTeam}" or "${awayTeam}".`
      : `This screenshot is an AFL match team sheet for two clubs.`;
  return `You are reading a screenshot of an official AFL (Australian Football League) team sheet / line-ups (from the AFL app or afl.com.au Match Centre). ${matchLine}

Layouts you may see:
1) Field / formation view — players under Backs, Half Backs, Centres, Half Forwards, Forwards, Followers, then Interchange, then Emergencies.
2) List view — columns of players with a centre position label (FB, HB, C, HF, FF, FOL), then Interchanges, then an "Emergencies" row at the bottom with BOTH clubs' emergencies (e.g. "9 Nick Murray").

Extract EVERY named player into JSON. Respond with ONLY a JSON object — no prose, no code fences — matching exactly:
{"teams": [{"team": string, "players": [{"name": string, "jumper": number|null, "position": string|null, "status": "named"|"interchange"|"emergency"}]}]}

Rules:
- "team": the club name, matching one of the two clubs in the match.
- One entry per player on the team sheet, for BOTH clubs.
- "name": expand the initial+surname to the player's FULL name (first + last) using the guernsey number, club, and your knowledge of current AFL squads — e.g. for St Kilda "44 C. Wilkie" -> "Callum Wilkie". If you are not confident of the first name, return the surname exactly as shown (do NOT invent a first name).
- "jumper": the guernsey number as an integer, or null if unreadable.
- "position": the on-field position group heading (e.g. "Backs", "Half Back", "Followers", "FB"). Use null for interchange and emergency players.
- "status": "named" for any on-field / starting position row, "interchange" for Interchange/Interchanges only, "emergency" for Emergencies only.
- CRITICAL — Emergencies: ANY player in the Emergencies / Emergency / EMG row or section MUST be status "emergency", never "named" or "interchange". Example: if Adelaide lists "9 Nick Murray" under Emergencies, he is emergency even if he is a regular senior player. Emergencies are NOT in the selected 22/23 and usually will not play.
- Do NOT promote an emergency into "named" because you recognise the name.
- Do NOT include players from a separate "OUT" / "IN" / team-changes panel as named starters — only position groups + interchange + emergencies on the team sheet.
- Ignore umpires, coaches, sponsors and any "thanks to" banners.`;
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object in model response");
  }
  return text.slice(start, end + 1);
}

function normaliseStatus(s: unknown): LineupStatus {
  return s === "interchange" || s === "emergency" ? s : "named";
}

/**
 * Read one or more team-sheet screenshots in a single vision call and return
 * the named squads per club. Passing the two clubs in the match anchors team
 * assignment and lets the model expand initials to full names reliably.
 */
export async function readLineup(
  images: LineupImage[],
  context: { homeTeam?: string | null; awayTeam?: string | null } = {},
): Promise<ExtractedLineup> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (images.length === 0) {
    throw new Error("no images provided");
  }

  const prompt = buildPrompt(context.homeTeam ?? null, context.awayTeam ?? null);
  const content = [
    ...images.map((img) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: ALLOWED_MEDIA.has(img.mediaType) ? img.mediaType : "image/png",
        data: img.data,
      },
    })),
    { type: "text" as const, text: prompt },
  ];

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = json.content?.find((c) => c.type === "text")?.text ?? "";
  const parsed = JSON.parse(extractJson(text)) as ExtractedLineup;

  const teams = Array.isArray(parsed.teams) ? parsed.teams : [];
  return {
    teams: teams.map((t) => ({
      team: String(t.team ?? "").trim(),
      players: Array.isArray(t.players)
        ? t.players
            .map((p) => ({
              name: String(p.name ?? "").trim(),
              jumper: typeof p.jumper === "number" ? p.jumper : null,
              position:
                typeof p.position === "string" && p.position.trim()
                  ? p.position.trim()
                  : null,
              status: normaliseStatus(p.status),
            }))
            .filter((p) => p.name.length > 0)
        : [],
    })),
  };
}
