# HANDOFF.md — Matty's got big balls multi tracker

**Last updated:** July 2026 (post–first production merge to `master`).

State of the build, what's done, what's next. Pair with **`CLAUDE.md`**
(conventions/architecture) and **`README.md`** / **`docs/LOCAL-DEV.md`** (setup).

---

## Status: live and in use

- **Deployed** on Vercel with Neon Postgres.
- **Repo is public** on GitHub — secrets only in Vercel / local `.env.local`.
- **Multi-user:** invite-only via `ALLOWED_EMAILS`; each user sees **their own**
  bets, ROI, strike rate, and player record on Review and Bets.
- **Maintainer:** Stuart (`sfrench71@me.com`) — fixtures, lineups, predictions.
  Mates log their own multis.
- **Local dev:** feature branches, test locally, PR → merge `master`. GitHub CLI
  available on maintainer PC (`gh`).

Verify before merge:

```bash
npm run typecheck && npm run lint && npm run build
```

---

## Done (major features)

### Core platform

- Next.js 14 App Router, Tailwind dark UI, Drizzle + Neon, NextAuth allowlist.
- Fixtures dashboard (next / upcoming / in-play / results), AWST times.
- Crons: daily fixture refresh + morning-after settle/accuracy; **Monday**
  Strategy lab incremental (`/api/cron/backtest-strategy`, label
  `strategy-lab-{year}`) once AFL Tables has the prior round.

### Lineups & predictions

- **Team sheet upload** via screenshot + Claude vision (`LineupUploadButton`,
  `POST /api/games/[id]/lineup`) — free alternative to Odds API player lists.
- **Generate predictions** seeds players from lineup, pulls AFL Tables history,
  persists Models A/B/C; Model C drives UI and suggestions (model lines; no
  paid odds API).

### Same-game multis (game page)

- **Suggested multi** — ranked legs (Any / Disposals / Marks / Tackles / Goals),
  adjustable leg count (1–25), editable targets, **+ Add player**.
- **Log this multi** — saves slip; **multiple slips per game** supported; ticket
  resets after each log.
- Claude **rationale** one-liner when `ANTHROPIC_API_KEY` set.
- Per-leg **your record** hint from past settled bets (light confidence nudge).

### Bet tracking

- **Bets page** — slips grouped by round, horizontal scroll; fixture header
  (Home v Away), jumper badges, delete pending slip, upload **result screenshot**
  for AI leg matching.
- **Live bet tracker** on game page — tap +/− while watching; remove leg; fix
  market; **Game over — settle my bets**.
- Manual slip entry (`/bets/new`) + AI read placement slip.
- Settlement: AFL Tables stats, live counts, result screenshots, cron pipeline.

### Review page (per user)

- Top stats: best model (global), **your** multis count, ROI, strike rate.
- **Your multis** — analytics by leg count (collapsible, default closed).
- **Round lineups** — one card per match, hit-rate badges from **your** betting
  history (collapsible, default closed).
- **Your player record** — filter/sort by stat, hit-rate bars.
- Model leaderboard table **removed** (model accuracy still in top “Best model”
  stat if data exists).

### Auth & data isolation

- Bets, legs, Review analytics scoped by `userId`.
- Round lineups and predictions are **shared** across users.

---

## Prediction engine (unchanged design)

Models A / B / C in `src/lib/predictions/engine.ts`. Model **C** is the smart
pick (form + opponent + venue factors). Suggestions use **C** projections +
`clearProbability()` for confidence (not raw 1-game hit rates).

Flow:

1. Upload lineup → **Generate predictions**.
2. Suggestions built in `buildSuggestions()` → optional `explainMultis()`.
3. After round: cron settles stats → legs → slips → `model_accuracy`.

---

## Next steps (backlog)

### High value

1. **Admin-only housekeeping** — restrict fixture sync, lineup upload, and
   generate predictions to `ADMIN_EMAIL` (e.g. `sfrench71@me.com`); mates see
   fixtures + betting only.
2. **Stronger personal-history nudge** in suggestions — e.g. boost unbeaten
   player×stat records after 2+ settled legs (keep capped until sample size
   grows).
3. **Update `README.md` title** to match app rebrand (nav already updated).

### Medium

4. ROI / strike-rate **over time** charts on Review.
5. Recent-form line chart on stat board (data largely ready).
6. Extend `venues.ts` aliases as mismatches appear.

### Lower / ongoing

7. Wire `players.aflTablesSlug` for duplicate-name edge cases.
8. Richer injury adapter beyond RSS heuristics.
9. Consider **private repo** or GitHub secret scanning if uneasy about public
   code (secrets must still never be committed).

---

## Known limitations

- **Auth** is email allowlist + credentials — a gate, not bank-grade auth.
- **AFL Tables** scraping breaks if HTML changes — app degrades, doesn't crash.
- **Any allowlisted user** can currently refresh fixtures / upload lineups — not
  yet limited to admin.
- **Live tracker** merges all legs from all slips on one game into one list (same
  player may appear multiple times if on several multis).
- Weekly Strategy lab cron assumes Pro (Monday schedule in `vercel.json`).
- **Public repo:** treat `.env.example` as documentation only; rotate keys if
  ever accidentally committed.

---

## Session handoff (for the next AI chat)

If this conversation is gone, tell the assistant:

> Read `CLAUDE.md` and `HANDOFF.md`. AFL multi tracker, deployed on Vercel,
> public GitHub repo, per-user bets, admin uploads lineups.

Recent work merged to `master` includes: bet tracker UX (fixture + jumpers),
Review collapsible sections, round lineups with hit badges, suggested multis
workflow, delete slip / remove leg, removed Settle now, app title rebrand.

---

## Quick links

| Topic | Where |
|-------|--------|
| Local setup | `README.md`, `docs/LOCAL-DEV.md` |
| Env vars | `.env.example` |
| Schema | `src/db/schema.ts` |
| Suggest multis | `src/lib/predictions/suggest.ts` |
| User bets | `src/lib/data/bets.ts` |
| Settlement | `src/lib/settle.ts` |
