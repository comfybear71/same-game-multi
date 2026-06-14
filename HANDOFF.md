# HANDOFF.md — AFL Multi Tracker

State of the build, what's done, what's next, and the open decision on the
prediction engine. Pair this with `CLAUDE.md` (conventions/architecture) and
`README.md` (setup).

## Status: scaffold complete, verified

`npm run typecheck`, `npm run lint`, and `npm run build` all pass on this
branch. Nothing has been deployed yet — the maintainer will wire Vercel + Neon,
protect the branch, and merge to `master`.

## Done

- **Repo scaffold:** Next.js 14 App Router + TypeScript, Tailwind (dark,
  mobile-first), ESLint, path alias `@/*`.
- **Database:** full Drizzle schema (`src/db/schema.ts`) covering users, games,
  players, player_game_stats, predictions, bookmaker_lines (Edge Finder),
  bets, bet_legs, model_accuracy, plus an api_cache table. Migration generated
  in `drizzle/`.
- **Auth:** NextAuth v4, invite-only via `ALLOWED_EMAILS`. Login page,
  route protection middleware, sign-out.
- **Ingest:**
  - Squiggle client (fixtures/results/standings) with required User-Agent.
  - The Odds API client (fixtures+h2h, per-event player props) with aggressive
    Postgres-backed caching to control paid usage.
  - AFL Tables client — defensive shell that degrades gracefully (parsing TODO).
  - Injury/news adapter — interface + empty (noop) adapter.
  - `sync.ts` upserts Squiggle fixtures into `games` and attaches Odds API
    event IDs by canonical team name.
- **Scheduling:** `vercel.json` crons — `refresh-fixtures` daily, plus
  `settle-results` morning-after AWST. Cron endpoints authorise via
  `CRON_SECRET`.
- **Settlement:** `settle.ts` marks legs hit/miss and rolls slips up to
  won/lost (activates once player stats are ingested).
- **UI:** fixtures dashboard (next game highlighted + upcoming + recent
  results), game detail (squad panels + model legend), bet tracker (summary +
  slip list), review/forecasting placeholders. Manual "Refresh fixtures" button.
- **Prediction engine:** Models A/B/C implemented as a pure, tunable function
  library — see the open decision below.

## Open decision — prediction engine (please confirm before I wire it in)

The brief said: *"Confirm the plan before writing the prediction engine."* I've
implemented the three models as a standalone, side-effect-free library
(`src/lib/predictions/`) so the design is concrete, but I have **not** yet wired
it into automated per-round generation or the accuracy scorecard. Proposed
design:

- **Model A — Simple:** season average for the stat.
- **Model B — Form-weighted:** linearly recency-weighted average of the last
  `formWindow` (default 5) games, blended with the season average by
  `formWeight` (default 0.6 toward form).
- **Model C — Smart:** Model B × opponent factor × venue factor, each centred
  on 1.0 and clamped to `[0.8, 1.2]` (default) to avoid silly extremes.
  - *Opponent factor:* how much this opponent concedes of the stat vs league
    average (e.g. a team that gives up lots of marks lifts a marks prediction).
  - *Venue factor:* ground size / the player's record at the venue.

Parameters live in `src/lib/predictions/types.ts` (`DEFAULT_PARAMS`).

**Questions for you:**
1. Are the default weights (`formWeight 0.6`, `formWindow 5`, clamp `0.8–1.2`)
   a sensible starting point, or do you want different values?
2. For Model C, how should opponent/venue factors be derived — from AFL Tables
   match history, Squiggle, or kept as manual multipliers initially?
3. What counts as a prediction "hit" for the accuracy scorecard — within ±X of
   actual, or did it correctly call over/under the bookmaker line?

Once confirmed I'll: generate predictions per player/stat/model each round,
store them, settle against actuals, and populate `model_accuracy` + the Review
dashboard.

## Next steps (after the prediction-engine confirmation)

1. **Player ingestion** — implement the AFL Tables parser in `aflTables.ts`
   (season game-by-game stats), upsert `players` + `player_game_stats`. This
   unlocks form, head-to-head history, settlement, and Model B/C inputs.
2. **Player props storage** — loop Odds API event IDs, store lines in
   `bookmaker_lines`; build the **Edge Finder** (our model vs bookie line).
3. **Predictions pipeline** — generate + persist predictions; render the
   per-player bar chart (predicted vs season avg), form line chart, and a
   game-level summary chart.
4. **Bet entry form** — create slips + legs (player, stat, line, odds, stake,
   confidence, notes) with **screenshot upload to Vercel Blob**.
5. **Review dashboard** — model leaderboard (MAE / hit rate per stat), ROI and
   strike-rate-over-time charts from settled bets and `model_accuracy`.
6. **Injuries** — wire a real RSS/scrape adapter behind the existing interface.

## Known limitations / notes

- **Auth is lightweight** (email-allowlist credentials) — a gate, not strong
  auth. To harden: switch to a NextAuth Email magic-link provider (needs SMTP
  env) or an OAuth provider (needs client id/secret env), then enforce the same
  allowlist in the `signIn` callback.
- **AFL Tables parsing is unimplemented** by design (brittle HTML). The shell
  fetches + caches; add the table selectors once verified against live markup.
- **Cron frequency:** Vercel Hobby allows daily crons, which is what's
  configured. Bump frequency on a paid plan if you want intra-day refreshes.
- **Free-tier friendliness:** all external calls go through `lib/ingest/cache.ts`
  (Postgres TTL cache, with stale-on-error fallback). The Odds API responses log
  remaining quota.
