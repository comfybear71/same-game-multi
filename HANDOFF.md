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
- **AI helm / System book (phase 1):** policy derived from Strategy lab
  (slip hit + flat ROI → strategy tiers). Review “AI helm”; game page
  “System book” portfolio (separate from personal bets); Suggested multi
  seeds focus/legs from policy. Grade on game-over / settle cron.
  Migration `0009_nifty_midnight`.
- **Bankroll sim (phase 2):** walk-forward $10/game unit on graded lab slips,
  policy recomputed each round, 10% grow / +$10 top-up, season checkpoints.
  Review “Bankroll sim”; `npm run bankroll`. Migration `0010_brave_wallop`.
- **Live System bank:** after placing helm tickets, enter **stake + bookie odds**
  on each System book slip; Review “Live System bank” tallies season P&L
  (`cashReturn = stake × placedOdds` on hit). Migration `0011_sturdy_quentin_quire`.

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

### Nav pages

- **System** (`/system`) — Live System bank (prominent) + AI helm. Season cash
  tally for helm tickets (stake × bookie odds).
- **Lab** (`/lab`) — Strategy lab + Bankroll sim (backtests / historical dollars).
- **Review** (`/review`) — personal Multis stats, Round lineups, Your player
  record. Top stats: best model, multis, ROI, strike rate.

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

### Experiments (done)

- **Wide + spread backtest** run `#8` `exp-wide-spread-2024-2025-2026`: 586
  games, 32 923 slips (legs 3–25 × 5 focuses, no player overlap across slips).
  Model-odds $5 flat report: 3 521/32 923 hit · P&L +$150 450 (91.4% ROI) —
  long-shot heavy; 15–16 legs were −100%. Does **not** refresh live AI helm.
  Lab still prefers `full-*` over `exp-*`. Re-run:
  `npx tsx scripts/backtest-sgm.ts --wide --spread --seasons='2024,2025,2026' --stake=5`

### Medium

4. **Players DB enrichment from AFL.com.au profiles** — persist canonical
   **position** on `players` (Key Defender / Defender / Midfielder / Forward /
   Key Forward / Ruck) so Leaders + System book stop showing `UNK`. Example
   source: `https://www.afl.com.au/players/2304/caleb-serong` (Serong =
   Midfielder). Later fields from the same profile pages: games, debut, DOB,
   height, draft, awards, season vs career avgs. Prefer storing position on
   `players` (not only `lineup_players` free text). May need AFL player id /
   slug column for stable joins.
5. ROI / strike-rate **over time** charts on Review.
6. Recent-form line chart on stat board (data largely ready).
7. Extend `venues.ts` aliases as mismatches appear.

### Lower / ongoing

8. Wire `players.aflTablesSlug` for duplicate-name edge cases.
9. Richer injury adapter beyond RSS heuristics.
10. Consider **private repo** or GitHub secret scanning if uneasy about public
    code (secrets must still never be committed).

---

## Known limitations

- **Auth** is email allowlist + credentials — a gate, not bank-grade auth.
- **AFL Tables** scraping breaks if HTML changes — app degrades, doesn't crash.
- **Any allowlisted user** can currently refresh fixtures / upload lineups — not
  yet limited to admin.
- **Live tracker** merges all legs from all slips on one game into one list (same
  player may appear multiple times if on several multis).
- **Player position** is only free-text on lineups today → many Leaders /
  System book rows show `UNK` (e.g. Serong). Fix via players-DB enrichment
  backlog item above.
- Weekly Strategy lab cron assumes Pro (Monday schedule in `vercel.json`).
- **Public repo:** treat `.env.example` as documentation only; rotate keys if
  ever accidentally committed.

---

## Session handoff (for the next AI chat)

If this conversation is gone, tell the assistant:

> Read `CLAUDE.md` and `HANDOFF.md`. AFL multi tracker, deployed on Vercel,
> public GitHub repo, per-user bets, admin uploads lineups.

### Product direction — “AFL brain” (maintainer intent)

1. **Lab H2H playbooks** (recipe × market × leg band, keep red ROI visible)
   steer **AI helm / System book per fixture** — not only global recipe ranks.
   Prefer high hit-rate bands (e.g. 60% marks 4–6); keep long-shot flutters
   small ($5). Exp/wide runs stay research-only (do not refresh live helm).
2. Then **player shortlists** by market + role (Elite→Avg; KEYF vs MID etc.).
3. More features later to deepen matchup / player×opponent learning.

Lab UX already supports dials + dollar/H2H dashboard.

**Helm bridge:** `src/lib/system/playbook.ts` blends global AI helm ranks with
Lab H2H recipe stats per fixture. Dry-run:
`npx tsx scripts/preview-system-book.ts` / POST system-book `{ preview: true }`.
Each System book always ends with a **FUN** long **Any** flutter (**≥10 legs**,
huge upside / $5 lottery) — tier badge `fun`, sorted last.

**Stats leaders + benchmarking:** `/leaders` · `src/lib/data/leaders.ts` —
season avgs (D/M/T/G from features; kicks/handballs from AFL Tables), position
buckets, Elite / Above / Average / Below bands. **Wired into System book /
`buildSuggestions`:** Elite→Average preferred, Below demoted
(`getGameBenchmarkBands`). Personal Suggested multi UI unchanged unless opts
passed.

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
