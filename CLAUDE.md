# CLAUDE.md — AFL Multi Tracker

Guidance for Claude (and humans) working in this repo. Read this before making
changes.

## What this is

A mobile-first + desktop web app for **AFL same-game multi** prediction and bet
tracking. Solo / small-group tool, **not** a public product. **AFL only** — no
other sport appears anywhere in the UI or data layer.

Operated from Perth: **all displayed times are AWST (UTC+8, no DST)**.

## Stack (non-negotiable)

- **Next.js 14** (App Router, TypeScript) — pinned to the latest patched 14.2.x.
- **Neon** Postgres via `@neondatabase/serverless` + **Drizzle ORM**.
- **NextAuth** (v4) — multi-user, invite-only via an email allowlist env var.
- **Tailwind CSS**, mobile-first.
- **Recharts** for charts.
- Deploy target: **Vercel** (+ Vercel Cron, Vercel Blob).

## Conventions

- **Branch:** do all work on a feature branch, never on `master`. The current
  working branch is `claude/afl-multi-tracker-pt8lwr`. (The original brief named
  `afl-claude`; align the name with the maintainer before merging.)
- **Commits:** clear, descriptive, imperative subject lines. Keep related
  changes together.
- **PRs:** open against `master`. Describe what changed, why, how it was
  verified (typecheck/build/lint), and any new env vars. Don't merge to
  `master` directly — the maintainer protects the branch and merges.
- **Complete files only.** No partial snippets committed.
- **Secrets:** never hardcode. Every secret comes from an env var listed in
  `.env.example`. `ODDS_API_KEY` in particular must only ever be read from the
  environment.

## Project layout

```
src/
  app/
    api/
      auth/[...nextauth]/route.ts   NextAuth handler
      cron/refresh-fixtures/route.ts   daily fixtures + odds sync (Vercel Cron)
      cron/settle-results/route.ts     morning-after results + bet settlement
      sync/route.ts                    manual fixture sync (signed-in users)
    games/[id]/page.tsx             game detail (squads + predictions)
    bets/page.tsx                   bet tracker
    review/page.tsx                 forecasting / accuracy dashboard
    login/page.tsx                  invite-only sign in
    page.tsx                        fixtures dashboard (next game + upcoming)
    layout.tsx, providers.tsx, globals.css
  components/                       UI + Recharts charts
  db/
    schema.ts                       Drizzle schema (source of truth)
    index.ts                        lazy Drizzle client
    migrate.ts                      standalone migration runner
  lib/
    env.ts                          validated, lazy env access
    auth.ts                         NextAuth options + allowlist
    time.ts                         AWST formatting helpers
    cron.ts                         cron auth + season helper
    settle.ts                       bet leg/slip settlement
    afl/teams.ts                    team-name canonicalisation across sources
    data/                           UI read helpers (games, bets)
    ingest/                         external data clients
      cache.ts                      Postgres-backed fetch-through cache
      squiggle.ts                   Squiggle API (fixtures/results/standings)
      oddsApi.ts                    The Odds API (fixtures, h2h, player props)
      aflTables.ts                  AFL Tables scrape (degrades gracefully)
      injuries.ts                   injury/news adapter (STUB)
      sync.ts                       upsert fixtures into the DB
    predictions/
      types.ts                      model inputs/outputs/params
      engine.ts                     Models A / B / C
drizzle/                            generated SQL migrations
```

## Data sources

1. **The Odds API** (paid tier, player props) — `aussierules_afl`. Key in
   `ODDS_API_KEY` only. Fixtures+h2h is one cheap call; player props are
   per-event — loop event IDs and **cache aggressively** (`lib/ingest/cache.ts`).
2. **Squiggle API** (free, no key) — results, fixtures, standings. Requires a
   descriptive `User-Agent` (set from `SQUIGGLE_CONTACT`).
3. **AFL Tables** — historical player stats by scraping. Flaky by nature;
   everything in `aflTables.ts` returns empty/logs rather than throwing.
4. **Injury/news** — STUB. `injuries.ts` defines the interface + an empty
   adapter. UI shows "—" until wired.

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build (must pass before PR)
npm run typecheck    # tsc --noEmit (must pass before PR)
npm run lint         # next lint (must pass before PR)
npm run db:generate  # generate a new SQL migration from schema.ts
npm run db:migrate   # apply migrations to DATABASE_URL
npm run db:studio    # drizzle studio
```

Before opening a PR, `npm run typecheck && npm run lint && npm run build` must
all pass.

## Gotchas

- **Env is validated lazily.** `lib/env.ts` only validates on first property
  access so `next build` works without secrets. The DB client (`db/index.ts`)
  and the NextAuth `secret` deliberately avoid eager env reads for the same
  reason. Keep new module-level code from reading required env at import time.
- **Times are stored as UTC, displayed as AWST.** Use `lib/time.ts`. Squiggle
  returns local wall-clock + tz offset; `sync.ts` converts to UTC.
- **Team names differ per source.** Always run external names through
  `canonicalTeam()` (`lib/afl/teams.ts`) before joining/deduping.
