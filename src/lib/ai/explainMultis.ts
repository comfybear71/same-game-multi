import { env } from "@/lib/env";
import type { RiskTier, Suggestion } from "@/lib/predictions/suggest";

// Add a short, friendly rationale to each risk tier. Uses Claude when
// ANTHROPIC_API_KEY is set; otherwise falls back to a sensible templated line.

const MODEL = "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";

const FALLBACK: Record<RiskTier, string> = {
  cautious:
    "Our safest picks — strong recent form with predictions sitting comfortably over the line.",
  medium:
    "A balanced multi — good value where our model still likes the price.",
  high: "A longshot — bigger payout, lower chance, with some spicier picks our model rates.",
};

function summarise(s: Suggestion) {
  return {
    tier: s.tier,
    estOdds: s.estOdds,
    legs: s.legs.map((l) => ({
      player: l.playerName,
      stat: l.statType,
      line: l.line,
      prediction: Math.round(l.prediction * 10) / 10,
      hitRatePct: l.hitRate == null ? null : Math.round(l.hitRate * 100),
      odds: l.odds,
    })),
  };
}

export async function explainMultis(suggestions: Suggestion[]): Promise<Suggestion[]> {
  if (!env.ANTHROPIC_API_KEY) {
    return suggestions.map((s) => ({ ...s, rationale: FALLBACK[s.tier] }));
  }

  const prompt = `You are explaining AFL same-game multi suggestions to a casual punter (keep it warm and simple, no jargon).
For each tier, write ONE short sentence (max 28 words) on why these picks suit that risk level, referencing the form/lines where it helps.
Tiers data: ${JSON.stringify(suggestions.map(summarise))}
Respond with ONLY a JSON object: {"cautious": string, "medium": string, "high": string}.`;

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
        max_tokens: 400,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<RiskTier, string>;
    return suggestions.map((s) => ({
      ...s,
      rationale: parsed[s.tier] || FALLBACK[s.tier],
    }));
  } catch (err) {
    console.warn("[explainMultis] falling back:", err);
    return suggestions.map((s) => ({ ...s, rationale: FALLBACK[s.tier] }));
  }
}
