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
    Postgres-backed caching to control paid usage. `props.ts` stores prop lines.
  - AFL Tables client — **implemented & verified** parser for per-player
    game-by-game logs + venue splits + current team; degrades gracefully.
  - `playerStats.ts` settles actual player stats from AFL Tables after a game.
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
- **Prediction engine:** Models A/B/C implemented and wired end-to-end —
  features from AFL Tables history, persisted predictions, settlement, and the
  `model_accuracy` scorecard. See the section below.
- **Edge Finder:** game detail shows our Model C vs the median bookmaker line
  (edge column + chart).

## Prediction engine — decided & implemented

The model design was confirmed and is now wired end-to-end (parser → features →
models → predictions → settlement → accuracy). Decisions made:

- **Defaults kept:** `formWeight 0.6`, `formWindow 5`, factor clamp `0.8–1.2`
  (`src/lib/predictions/types.ts` → `DEFAULT_PARAMS`). Easy to tune.
- **Model C factors come from AFL Tables history** (as requested):
  - *Opponent factor* = the player's mean for the stat vs that opponent ÷ career
    mean, shrunk toward 1.0 by sample size (`SHRINK_K = 4`) so a couple of games
    don't swing it. (This is the player's own matchup history — the most
    reliable thing AFL Tables exposes per player.)
  - *Venue factor* = the player's mean at the venue (from the AFL Tables venue
    split table) ÷ career mean, same shrinkage. Falls back to 1.0 when the
    venue name can't be matched (see `src/lib/afl/venues.ts`).
- **Accuracy = MAE + line call** (both): `model_accuracy` stores mean absolute
  error and the share of predictions on the correct side of the bookmaker line,
  per model and stat. The Review page highlights the lowest-MAE model.

The models (`src/lib/predictions/engine.ts`):
- **A — Simple:** current-season average (blends in prior season when thin).
- **B — Form-weighted:** recency-weighted last-5 blended 60/40 with season avg.
- **C — Smart:** Model B × opponent factor × venue factor (clamped).

**Verified:** the AFL Tables parser + feature/model pipeline were run against a
live player page (Bontempelli, 271 games / 13 seasons) and produce sensible
outputs. See `parseGameLog`/`buildInputs`/`runAllModels`.

### How predictions flow

1. On a game page, **Fetch props & predict** (`POST /api/games/[id]/predict`)
   pulls The Odds API player lines (`syncPlayerProps` → `bookmaker_lines`) and
   runs `generatePredictions`: resolves each propped player's team from AFL
   Tables, builds inputs, persists A/B/C to `predictions`.
2. Game detail shows the per-player table (A/B/C, line, edge = C − line, actual)
   plus a Recharts bar chart.
3. The morning-after cron settles actuals from AFL Tables
   (`settleGamePlayerStats`), settles bet legs/slips, then
   `computeRoundAccuracy` writes `model_accuracy`. The Review page renders the
   leaderboard.

Prop fetching is **on-demand** (a button), not in the daily cron, to keep paid
The Odds API usage bounded.

## Next steps

1. **Bet entry form** — create slips + legs (player, stat, line, odds, stake,
   confidence, notes) with **screenshot upload to Vercel Blob**. Read/settle
   paths already exist; only the create UI/route is missing.
2. **Recent-form line chart** on the player view (engine + data are ready).
3. **ROI / strike-rate over time** charts on Review (cumulative from settled
   bets) — leaderboard is live; these time-series charts are the remaining bit.
4. **Venue-name coverage** — extend `src/lib/afl/venues.ts` aliases as you spot
   Squiggle/AFL Tables mismatches (factor is bounded + falls back to 1.0).
5. **Player name → AFL Tables slug** edge cases — duplicate names / punctuation
   get numeric suffixes on AFL Tables. The `players.aflTablesSlug` column exists
   for manual overrides; wire it into `getPlayerHistory` calls where needed.
6. **Injuries** — wire a real RSS/scrape adapter behind the existing interface.

## Known limitations / notes

- **Auth is lightweight** (email-allowlist credentials) — a gate, not strong
  auth. To harden: switch to a NextAuth Email magic-link provider (needs SMTP
  env) or an OAuth provider (needs client id/secret env), then enforce the same
  allowlist in the `signIn` callback.
- **AFL Tables parsing is implemented** and verified against a live player page,
  but it's still scraping brittle HTML — if AFL Tables changes layout, the
  parser returns empty and the app degrades (factors → 1.0, stats stay pending)
  rather than breaking. Re-verify selectors if data goes missing.
- **Cron frequency:** Vercel Hobby allows daily crons, which is what's
  configured. Bump frequency on a paid plan if you want intra-day refreshes.
- **Free-tier friendliness:** all external calls go through `lib/ingest/cache.ts`
  (Postgres TTL cache, with stale-on-error fallback). The Odds API responses log
  remaining quota.
