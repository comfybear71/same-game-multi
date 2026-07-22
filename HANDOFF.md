# HANDOFF.md — Matty's got big balls multi tracker

**Last updated:** July 2026 (System book v2 edge package behind flag — review backtest).

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
- **Settle is append-only for recent rounds:** daily settle cron targets the
  latest completed round (+ previous if AFL Tables lags), plus any games with
  ungraded System tickets or pending personal legs. It does **not** re-scrape
  the whole season — R0–prior rounds already in `player_game_stats` stay put.
  Per game it only fetches predicted/lineup players still unset, then grades
  System + personal bets. When new stats land it also catches up Strategy lab +
  bankroll. Leaders read settled `player_game_stats` averages (not stale
  predict-time features). Manual: `npm run settle:now -- --round=N`
  (`--lab` forces Lab/bankroll even if stats already recorded).
- **System book (phase 1):** game-page portfolio (separate from personal bets).
  Quiet season baseline from Lab still used as a prior + Suggested multi
  default tip; **not** shown as a separate “AI helm” UI. Grade on game-over /
  settle cron. Migration `0009_nifty_midnight`.
- **Bankroll sim (phase 2):** walk-forward $10/game unit on graded lab slips,
  policy recomputed each round, 10% grow / +$10 top-up, season checkpoints.
  Review “Bankroll sim”; `npm run bankroll`. Migration `0010_brave_wallop`.
- **Live System bank:** after placing System book tickets, enter **stake + bookie
  odds** on each slip; `/system` tallies season P&L
  (`cashReturn = stake × placedOdds` on hit). Locked once saved. Migration
  `0011_sturdy_quentin_quire`.

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

- **System** (`/system`) — Live System bank only (season cash on placed tickets).
- **Lab** (`/lab`) — Strategy lab + Bankroll sim (styles / H2H / historical $).
- **Leaders** (`/leaders`) — player season bands (Elite→Below) for System book.
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

### Odds API harvest (calibration dataset)

Paid Odds API sub has ~1 month left. App does **not** use live odds.
Harvest player props into append-only `odds_snapshots` for later model % vs
bookie implied % analysis:

```bash
npm run db:migrate          # applies 0012_odds_snapshots
npm run harvest:odds        # needs ODDS_API_KEY in .env.local
npm run test:odds-harvest
```

Markets (docs): `player_disposals`, `_over`, `player_goals_scored_over`,
`player_marks_over`, `player_tackles_over`, `player_afl_fantasy_points` (+ `_over`).
Quota floor default 50 remaining. **Auto harvest cron enabled** in
`vercel.json`: `/api/cron/harvest-odds` Wed + Fri 18:00 AWST and Sat 08:00
AWST (needs `ODDS_API_KEY` in Vercel). Kill switch: `HARVEST_ODDS_CRON=off`.
Manual: `npm run harvest:odds`.

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

**Product story:** Lab finds styles (global + who-vs-who) → System book applies
them to this game → Leaders shortlists players (Elite→Avg). `/system` is the
money tracker only — no separate “AI helm” panel.

1. **Lab H2H playbooks** (recipe × market × leg band, keep red ROI visible)
   steer **System book per fixture** — not only global recipe ranks.
   Prefer high hit-rate bands (e.g. 60% marks 4–6); keep long-shot flutters
   small ($5). Exp/wide runs stay research-only (do not refresh live baseline).
2. Then **player shortlists** by market + role (Elite→Avg; KEYF vs MID etc.).
3. More features later to deepen matchup / player×opponent learning.

**Quiet baseline:** Lab full runs still refresh a stored season prior
(`system_policy`) used as blend weight + Suggested multi default — not a
user-facing “helm” page.

**Bridge:** `src/lib/system/playbook.ts` blends that prior with Lab H2H per
fixture. Dry-run: `npx tsx scripts/preview-system-book.ts` / POST system-book
`{ preview: true }`. Each System book ends with a **FUN** long **Any** flutter
(**≥10 legs**, $5 lottery) — tier `fun`, sorted last.

**Stats leaders + benchmarking:** `/leaders` · `src/lib/data/leaders.ts` —
season avgs (D/M/T/G from features; kicks/handballs from AFL Tables), position
buckets, Elite / Above / Average / Below bands. **Wired into System book /
`buildSuggestions`:** Elite→Average preferred, Below demoted
(`getGameBenchmarkBands`). Personal Suggested multi UI unchanged unless opts
passed.

## Portfolio fill plan — "anti-Daicos-everywhere" (LOCKED, July 2026)

**Problem:** per-ticket greedy fill produces a correlated book — the same
elite names win every ticket slot, so one quiet night from one player kills
multiple tickets at once. Observed on Carlton v Collingwood book (Nick +
Cripps cloned across Disp·3/·4/·5).

**Locked config:**

```text
CORE_MAX = 2 per fixture (must be DISTINCT markets; an "Any" core counts
           as the stat family its model probability rides on)
Core is earned per-fixture: top 1-2 by final soft score, AND must clear a
           personal floor of shrunk tape >= 60% (no global core list)
Exposure unit = player + market (Nick·disposals counts once across lines)
Fill = snake draft across all non-FUN tickets simultaneously (not A→B→C)
Appearance penalty = quadratic soft penalty (score' = score − λ·appearances²)
Hard wall = 3 appearances per exposure unit across non-FUN tickets
           (absolute circuit-breaker only)

--- Amendment (System book v2 — Jul 2026) ---
Satellite rule (when PORTFOLIO_EDGE_SCORE=on):
  Non-cores: max 1 appearance per player×market across non-FUN tickets
  Cores:     max 2 appearances (same exposure unit)
  Wall 3 remains only as absolute circuit-breaker
Odds edge (same flag): soft-score += w_edge × (model% − implied%)
  Price: odds_snapshots (latest per player×market×line) PRIMARY,
         bookmaker_lines fallback. Missing price → skip edge term only.
  Also: line-vs-season-avg cushion; last-5 trend (smaller weight).
Last-game leaders (same flag): top 3 per stat from BOTH clubs' previous
  completed games → small soft bonus for legs IN THAT CATEGORY only.
  UI: EDGE badge (+EV green / taxed red) + HOT badge ("5 goals last wk").
Team cap / book lean / FUN core-free: unchanged.

Team cap = ≤50% of legs per ticket from one club
Book lean = warning (not block) at ~60% single-club across non-FUN book;
           display "Book lean: X% <club>" on System book before lock
FUN ticket = exempt from caps but CORE-FREE (it is the hedge against the
           book being wrong, built from model-liked players the draft passed)
Personal tape = shrinkage-adjusted modifier, capped at ±10 soft-score
           points. adjusted = (hits + priorHits) / (n + priorN),
           prior ≈ 10 legs @ 65% baseline (tunable; optional 0.9/round
           decay). NEVER raw win-loss records.
```

> Personal history enters as a shrinkage-adjusted modifier capped at ±10
> points, never as raw win–loss — at n≤3 your ticks are mostly luck
> wearing a jersey.

**Division of labour:** Model + Leaders say who's good · shrunk personal
tape says who's good *for you* (tie-break only) · snake draft + penalties +
caps spread the book · core–satellite keeps conviction without cloning.

**Gate:** NO production fill change until a backtest pass shows, vs greedy
fill on the same rounds: effective-independent-bets ↑, max player
appearances ↓, drawdown on quiet-star nights ↓. If not, retune λ / wall
first.

**Metric:** `/system` (and game System book pre-lock) shows effective
independent bets = tickets × (1 − avg pairwise leg overlap), plus max
appearances and book lean %, before lock.

**Lab UX note:** “What we learned” / strategy tables sort by **slip hit**
first (ROI tie-break) — lottery +ROI must not lead the story.

**Deliberately NOT in v1:** round-level multi-fixture optimiser · hard bans
from single misses · FUN under full portfolio rules.

**Build status (draft fill ON by default — Jul 2026):**
- Engine: `src/lib/system/portfolioFill.ts` + bridge `portfolioFillBridge.ts`
- Tests: `npm run test:portfolio-fill` · Backtest: `npm run backtest:portfolio`
  → `docs/portfolio-fill-backtest.md` (λ=4 recommended; gate PASS).
- Default ON after review; set `PORTFOLIO_DRAFT_FILL=off` to revert greedy.
- System book UI shows effective independent bets, max appearances, book lean.

**System book v2 (edge package — FLAG OFF pending review):**
- Satellite-1 + odds edge + cushion + last-5 + last-game leaders.
- Flag: `PORTFOLIO_EDGE_SCORE` (default **off**). Does not touch draft-fill flag.
- Modules: `edgeScore.ts`, `oddsPrices.ts`, `lastGameLeaders.ts` (+ Db).
- Backtest: `npm run backtest:portfolio-edge` → `docs/portfolio-edge-backtest.md`.
- Stop after report; maintainer flips flag if gate PASS.
- **Goals rung cap:** max target = floor(seasonAvg)+1 (stops Stringer 4+ on a 2.1 avg).
- **3-card chooser (localhost sketch):** when edge flag on, Refresh builds
  edge (green) / hot (orange) / spread (sky) cards per multi; tap to select.
  `chooser.ts` + `SystemBookPanel` grid. **De-emphasised** — Top 10 DIY boards
  are the primary personal build path (see below).

### Top 10 DIY boards (Jul 2026 — primary personal build path)

**Intent:** Transparent punter boards on each game page — not opaque 3-card AI
choosers. Mobile-first tap-to-build multis logged via existing personal bets flow.

**Where it lives:**
- **Game page** (`Top10BoardPanel`): primary section when predictions exist.
  Top 10 × 2 clubs × 4 markets (D/M/T/G). Interactive ticket builder + Log this multi.
- **System page** (`/system`): P&amp;L tracker only; header links punters back to
  fixture Top 10 boards. System book chooser remains on game page (collapsed) for
  helm portfolio when needed.

**Line pick rule (LOCKED):** `pickBoardLine()` in `top10Board.ts` — default rung
sits **near season average / middle of ladder**, never the highest clearable rung
(unlike `suggest.chooseRung`). `clearProbability()` is display-only on the ticket,
**must not** drive rung selection. Goals capped via `capGoalsLine`.

**Data:** predictions + features + Leaders bands + personal tape + odds_snapshots
(primary) / bookmaker_lines (fallback). Empty odds → honest "—", no invented prices.

**API:** `GET /api/games/[id]/top10` (auth'd allowlist user).

**Debug:** `npm run dump:top10` or `npx tsx scripts/dump-top10.ts --match=Adelaide,Collingwood`.

**Tests:** `src/lib/predictions/top10Board.test.ts` (ranking + line pick).

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
