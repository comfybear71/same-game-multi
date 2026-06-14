import { env } from "@/lib/env";

// Read an AFL same-game-multi bet-slip screenshot with Claude vision and return
// structured legs. Uses the Anthropic Messages API directly (no SDK dependency).

// Cheap, fast, vision-capable. Bump to a Sonnet model if extraction ever misses
// small text like odds.
const MODEL = "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";

const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export interface ExtractedLeg {
  player: string;
  statType: "disposals" | "marks" | "tackles" | "goals" | null;
  line: number | null;
  odds: number | null;
  selection: "over" | "under" | null;
}

export interface ExtractedSlip {
  totalOdds: number | null;
  totalStake: number | null;
  legs: ExtractedLeg[];
}

const PROMPT = `You are reading a screenshot of an AFL (Australian Football League) same-game multi bet slip from a bookmaker (e.g. Sportsbet, TAB, Ladbrokes).

Extract the bet into JSON. Respond with ONLY a JSON object — no prose, no code fences — matching exactly:
{"totalOdds": number|null, "totalStake": number|null, "legs": [{"player": string, "statType": "disposals"|"marks"|"tackles"|"goals"|null, "line": number|null, "odds": number|null, "selection": "over"|"under"|null}]}

Rules:
- One entry in "legs" per player selection on the slip.
- "player" is the player's full name as shown.
- "statType": map the market to one of disposals, marks, tackles, goals. If it's a different market (e.g. goal scorer, fantasy points), use null.
- "line": the numeric threshold. For an "N+" market (e.g. "25+ Disposals"), use N minus 0.5 (so 25+ -> 24.5). For "Over/Under N.5", use that number.
- "selection": "over" for "N+" or "Over" markets, "under" for "Under" markets, else null.
- "odds": decimal odds for that leg if shown, else null.
- "totalOdds" and "totalStake": the multi's combined odds and the stake/wager amount if shown, else null.
Numbers must be plain numbers (no "$" or "x").`;

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object in model response");
  }
  return text.slice(start, end + 1);
}

export async function readBetSlip(imageUrl: string): Promise<ExtractedSlip> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new Error(`could not fetch image: ${imgRes.status}`);
  }
  const ct = (imgRes.headers.get("content-type") || "image/png").split(";")[0];
  const mediaType = ALLOWED_MEDIA.has(ct) ? ct : "image/png";
  const base64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = json.content?.find((c) => c.type === "text")?.text ?? "";
  const parsed = JSON.parse(extractJson(text)) as ExtractedSlip;

  // Normalise into safe shapes.
  return {
    totalOdds: typeof parsed.totalOdds === "number" ? parsed.totalOdds : null,
    totalStake: typeof parsed.totalStake === "number" ? parsed.totalStake : null,
    legs: Array.isArray(parsed.legs)
      ? parsed.legs.map((l) => ({
          player: String(l.player ?? "").trim(),
          statType: ["disposals", "marks", "tackles", "goals"].includes(
            l.statType as string,
          )
            ? l.statType
            : null,
          line: typeof l.line === "number" ? l.line : null,
          odds: typeof l.odds === "number" ? l.odds : null,
          selection:
            l.selection === "over" || l.selection === "under" ? l.selection : null,
        }))
      : [],
  };
}
