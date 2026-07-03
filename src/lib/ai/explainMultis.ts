import { env } from "@/lib/env";
import type { Suggestion } from "@/lib/predictions/suggest";

// Add a short, friendly rationale to the suggested multi. Uses Claude when
// ANTHROPIC_API_KEY is set; otherwise falls back to a sensible templated line.

const MODEL = "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";

const FALLBACK =
  "Ranked by our model's confidence — the steadiest legs first. Add more for a bigger payout; each one multiplies into a lower combined chance.";

function summarise(s: Suggestion) {
  return {
    estOdds: s.estOdds,
    combinedChance: s.combinedChance,
    legs: s.legs.map((l) => ({
      player: l.playerName,
      stat: l.statType,
      line: l.line,
      prediction: Math.round(l.prediction * 10) / 10,
      hitRatePct: l.hitRate == null ? null : Math.round(l.hitRate * 100),
      odds: l.odds,
      // Qualitative context from AFL news (injury cloud, managed, named, etc.).
      news: l.news ? { status: l.news.status, note: l.news.note } : null,
    })),
  };
}

export async function explainMultis(suggestion: Suggestion): Promise<Suggestion> {
  if (suggestion.legs.length === 0) {
    return suggestion;
  }
  if (!env.ANTHROPIC_API_KEY) {
    return { ...suggestion, rationale: FALLBACK };
  }

  const prompt = `You are explaining an AFL same-game multi suggestion to a casual punter (keep it warm and simple, no jargon).
Write ONE short sentence (max 28 words) on why these picks were chosen, referencing the form/lines where it helps.
If a leg has a "news" field (an injury cloud, a managed/rested tag, or a late team-news note), weave that in plainly — e.g. flag a "test" as a slight risk. Players already ruled out have been removed.
Suggestion data: ${JSON.stringify(summarise(suggestion))}
Respond with ONLY a JSON object: {"rationale": string}.`;

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = JSON.parse(text.slice(start, end + 1)) as { rationale?: string };
    return { ...suggestion, rationale: parsed.rationale || FALLBACK };
  } catch (err) {
    console.warn("[explainMultis] falling back:", err);
    return { ...suggestion, rationale: FALLBACK };
  }
}
