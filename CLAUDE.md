# CLAUDE.md — Matty's got big balls multi tracker

Guidance for AI assistants (Cursor, Claude, etc.) and humans working in this
repo. **Read this and `HANDOFF.md` at the start of a session** before making
changes.

## What this is

A mobile-first + desktop web app for **AFL same-game multi** prediction and bet
tracking. Small private group tool among mates — **not** a commercial product.
**AFL only** — no other sport appears anywhere in the UI or data layer.

Operated from Perth: **all displayed times are AWST (UTC+8, no DST)**.

**Repo:** public on GitHub (`comfybear71/same-game-multi`). **Never commit
secrets** — see Security below.

## Stack (non-negotiable)

- **Next.js 14** (App Router, TypeScript) — pinned to the latest patched 14.2.x.
- **Neon** Postgres via `@neondatabase/serverless` + **Drizzle ORM**.
- **NextAuth** (v4) — multi-user, invite-only via an email allowlist env var.
- **Tailwind CSS**, mobile-first.
- **Recharts** for charts.
- Deploy target: **Vercel** (+ Vercel Cron, Vercel Blob).

## Security (public repo)

- **All secrets live in Vercel env vars and local `.env.local` only.** Never
  commit `.env`, `.env.local`, API keys, `DATABASE_URL`, or `NEXTAUTH_SECRET`.
- `.env.example` has **empty placeholders** — keep it that way.
- `tmp/` is gitignored (local scrape probes).
- Before any push: confirm Source Control / `git status` does not list `.env*`.
- `ALLOWED_EMAILS` controls who can sign in — set in env, not in source.

## Conventions

- **Branch:** do work on a **feature branch**, merge to `master` via PR on
  GitHub (or maintainer merge). Avoid force-pushing `master`.
- **Commits:** clear, descriptive, imperative subject lines. Keep related
  changes together. Complete files only — no partial snippets.
- **PRs:** describe what changed, why, how verified (`typecheck` / `lint` /
  `build`), and any new env vars.
- **Secrets in code:** never hardcode. Every secret comes from an env var listed
  in `.env.example`.

## Multi-user behaviour

- Each signed-in user has their **own bets** (`bets.userId`). Review stats,
  ROI, strike rate, player record, and multi analytics are **per user** — not
  aggregated across the group.
- **Round lineups** (uploaded squads) are **shared** — one admin uploads team
  sheets; everyone sees the same named players for predictions.
- **Fixture sync + lineup upload** are currently available to **any** allowlisted
  user. Maintainer intent: only admin (`sfrench71@me.com`) should do
  housekeeping — **admin gating not implemented yet** (see HANDOFF.md).

## Project layout

```
src/
  app/
    api/
      auth/[...nextauth]/route.ts      NextAuth handler
      bets/route.ts                    create slip + legs
      bets/[id]/route.ts               DELETE slip
      bets/legs/[id]/route.ts          PATCH leg / DELETE leg
      bets/[id]/result/route.ts        result screenshot → settle legs
      bets/read/route.ts               AI read placement slip
      bets/upload/route.ts             Vercel Blob upload
      cron/refresh-fixtures/route.ts   daily fixtures sync (Vercel Cron)
      cron/settle-results/route.ts     morning-after settle + accuracy
      cron/backtest-strategy/route.ts  Monday Strategy lab (current season)
      games/[id]/predict/route.ts      generate predictions (lineup roster)
      games/[id]/suggest/route.ts      suggested multi + Claude rationale
      games/[id]/candidates/route.ts   add-player picker pool
      games/[id]/lineup/route.ts       upload team-sheet screenshots
      games/[id]/game-over/route.ts    settle user's bets after a game
      games/[id]/live/route.ts         live game polling
      sync/route.ts                    manual fixture sync (signed-in)
      admin/migrate/route.ts           run migrations (signed-in)
    page.tsx                           fixtures dashboard
    games/[id]/page.tsx                game detail (stats, multi, live bets)
    bets/page.tsx                      bet tracker (slips by round)
    bets/new/page.tsx                  manual / AI slip entry
    review/page.tsx                    per-user review + round lineups
    login/page.tsx                     invite-only sign in
    layout.tsx, providers.tsx, globals.css
  components/
    SuggestedMultis.tsx                build + log multis on game page
    LiveBetTracker.tsx                 live leg tracking + game over
    StatBoardView.tsx                  per-stat player boards
    RoundRosterPanel.tsx               round lineups + game lineup panel
    PlayerRecordPanel.tsx              per-user player×stat history
    MultiStatsPanel.tsx                multis by leg count
    LineupUploadButton.tsx             screenshot lineup ingest
    SyncButton.tsx                     refresh fixtures
    DeleteBetButton.tsx, EditLegMarket.tsx, …
  db/
    schema.ts                          Drizzle schema (source of truth)
    index.ts                           lazy Drizzle client
    migrate.ts, loadDotenvLocal.ts
  lib/
    env.ts                             validated, lazy env access
    auth.ts                            NextAuth + allowlist
    time.ts                            AWST formatting
    cron.ts, settle.ts
    afl/teams.ts, afl/venues.ts, afl/teamColors.ts
    data/
      bets.ts                          slips, tracker, player record, enrich
      games.ts, statboard.ts, accuracy.ts, roundRoster.ts, …
    ingest/
      cache.ts, squiggle.ts, props.ts
      aflTables.ts, playerStats.ts, sync.ts, lineup.ts
      injuries.ts                      RSS adapter (partial)
    predictions/
      engine.ts, features.ts, generate.ts, suggest.ts
      probability.ts, modelLine.ts, accuracy.ts
    ai/
      readLineup.ts, readBetSlip.ts, readBetResult.ts, explainMultis.ts
drizzle/                               generated SQL migrations
docs/LOCAL-DEV.md                     local setup + git workflow
scripts/setup-local.mjs, check-env.mjs
```

## Data sources

1. **Lineup screenshots** (primary squad seed) — Claude vision reads AFL app /
   afl.com.au team sheets (`readLineup.ts` → `lineup_players`). Requires
   `ANTHROPIC_API_KEY`. Predictions run for named players only.
2. **AFL Tables** — player history, form, settlement actuals. Scraping — degrades
   gracefully on failure.
3. **Squiggle API** (free) — fixtures, results, standings. Real `User-Agent` via
   `SQUIGGLE_CONTACT`.
4. **Injury/news** — RSS via `AFL_NEWS_FEEDS`; coarse status affects suggestions.
   Model lines + estimated odds power suggestions (no paid odds feed).

## Typical weekly workflow (maintainer)

1. **Refresh fixtures** (Fixtures page or daily cron).
2. **Upload lineups** per game (screenshots on each fixture card).
3. **Generate predictions** on each game page (`POST …/predict`).
4. Mates build multis on the game page → **Log this multi** (multiple slips per
   game OK). Stake/odds optional.
5. During the game: **Your bets in this game** live tracker (+/− counts).
6. After the game: **Game over — settle my bets** or morning-after cron + result
   screenshot upload on Bets page.

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build (must pass before PR)
npm run typecheck    # tsc --noEmit (must pass before PR)
npm run lint         # next lint (must pass before PR)
npm run db:generate  # generate a new SQL migration from schema.ts
npm run db:migrate   # apply migrations to DATABASE_URL
npm run db:studio    # drizzle studio
npm run setup:local  # copy .env.example, generate NEXTAUTH_SECRET
npm run check:env    # sanity-check required env vars
```

Before opening a PR: `npm run typecheck && npm run lint && npm run build`.

## Gotchas

- **Env is validated lazily.** `lib/env.ts` validates on first access so
  `next build` works without secrets. Avoid eager env reads at module import.
- **Times:** stored UTC, displayed AWST (`lib/time.ts`).
- **Team names differ per source** — always `canonicalTeam()` before joins.
- **Suggested multis** rank legs by model confidence (+ fantasy on "Any" tab);
  personal betting history nudges confidence lightly (`withHistory` in
  `suggest.ts`). Review "hit badges" on round lineups are display-only unless
  wired further.
- **Settlement:** legs need `gameId` + matched `playerId` for auto-settle from
  AFL Tables; live counts + result screenshots are fallbacks.
- **No "Settle now" global button** — use per-game game-over or cron.

## For AI sessions (Cursor)

- Read **`HANDOFF.md`** for current status and backlog.
- Prefer **small, focused diffs**; match existing code style.
- Run **typecheck/lint** when changing non-trivial TypeScript.
- **Do not commit or push** unless the user explicitly asks.
- Agent chat history is ephemeral — put durable decisions in `HANDOFF.md`.
