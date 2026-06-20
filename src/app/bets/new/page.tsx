import Link from "next/link";

import { BetForm } from "@/components/BetForm";
import type { Game } from "@/db/schema";
import { getRecentResults, getUpcomingGames } from "@/lib/data/games";

export const dynamic = "force-dynamic";

export default async function NewBetPage() {
  let games: Game[] = [];
  try {
    const [upcoming, recent] = await Promise.all([
      getUpcomingGames(30),
      getRecentResults(12),
    ]);
    games = [...upcoming, ...recent];
  } catch {
    games = [];
  }

  const options = games.map((g) => ({
    id: g.id,
    round: g.round ?? null,
    label: `R${g.round ?? "?"} · ${g.home} v ${g.away}`,
  }));

  return (
    <div className="space-y-4">
      <Link href="/bets" className="text-sm text-accent hover:underline">
        ← Back to bets
      </Link>
      <BetForm games={options} />
    </div>
  );
}
