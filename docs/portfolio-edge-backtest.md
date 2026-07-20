# Portfolio edge package backtest — System book v2

**Generated:** 2026-07-19T04:41:12.061Z
**Season:** 2026 · **Games:** 20
**Flag:** `PORTFOLIO_EDGE_SCORE` remains **OFF** — do not enable from this report.

## What is compared

- **Live:** current draft fill (λ=4, hard wall 3, quadratic penalty, no satellite hard-cap, no edge/leaders).
- **v2 package:** satellite max-1 / core max-2 + odds edge + cushion + last-5 + last-game leaders (default weights).

## Gate

| Check | Live draft | v2 package | Pass? |
|-------|------------|------------|-------|
| Effective independent bets ↑ | 6.22 | 6.93 | YES |
| Max appearances ↓ | 2.95 | 2.00 | YES |
| Quiet-star nights (flat $1) | 0.00 (1) | 0.00 (1) | ok |
| Slip hit | 0.7% | 0.7% | — |
| Flat ROI | -97.5% | -97.7% | — |

**Overall gate: PASS** — ready for maintainer to consider `PORTFOLIO_EDGE_SCORE=on`.

## λ sanity (v2 package)

| λ | Eff. bets | Max apps | Slip hit | Flat ROI | Quiet $ |
|---|-----------|----------|----------|----------|---------|
| 4 | 6.93 | 2.00 | 0.7% | -97.7% | 0.00 |
| 8 | 6.94 | 2.00 | 0.7% | -97.7% | 0.00 |
| 12 ← lowest max apps | 6.94 | 2.00 | 0.7% | -97.7% | 0.00 |

## Edge weight sweep

| edgeWeight | Eff. bets | Max apps | Slip hit | Flat ROI |
|------------|-----------|----------|----------|----------|
| 30 ← best flat ROI | 6.93 | 2.00 | 0.7% | -97.7% |
| 50 | 6.93 | 2.00 | 0.7% | -97.7% |
| 80 | 6.93 | 2.00 | 0.7% | -97.7% |

## Leaders weight sweep

| leadersWeight | Eff. bets | Max apps | Slip hit | Flat ROI |
|---------------|-----------|----------|----------|----------|
| 3 ← best flat ROI | 6.93 | 2.00 | 0.7% | -97.7% |
| 6 | 6.93 | 2.00 | 0.7% | -97.7% |
| 10 | 6.93 | 2.00 | 0.7% | -97.7% |

## Recommendation

- Default weights in code: edge=50, cushion=12, trend=6, leaders=6.
- Sweep prefers λ=12, edgeWeight=30, leadersWeight=3 on this sample.
- Wall stays **3** as circuit-breaker; satellite-1 does the real anti-clone work.
- **Stop here.** Maintainer reviews, then sets `PORTFOLIO_EDGE_SCORE=on` if satisfied. Do not flip from this script.

## Per-game

| Game | Fixture | Live eff | v2 eff | Live max | v2 max | Live hits | v2 hits | Quiet |
|------|---------|----------|--------|----------|--------|-----------|---------|-------|
| 154 | Geelong v St Kilda | 6.27 | 6.96 | 3 | 2 | 0/7 | 0/7 |  |
| 147 | St Kilda v Port Adelaide | 6.08 | 6.96 | 3 | 2 | 0/7 | 0/7 |  |
| 146 | Collingwood v North Melbourne | 5.88 | 6.97 | 3 | 2 | 0/7 | 0/7 |  |
| 145 | Fremantle v Sydney | 6.32 | 6.92 | 2 | 2 | 0/7 | 0/7 |  |
| 144 | Port Adelaide v North Melbourne | 6.24 | 6.92 | 3 | 2 | 0/7 | 0/7 | yes |
| 143 | Essendon v St Kilda | 6.23 | 6.92 | 3 | 2 | 0/7 | 0/7 |  |
| 142 | Richmond v Carlton | 6.39 | 6.90 | 3 | 2 | 0/7 | 0/7 |  |
| 141 | Gold Coast v Collingwood | 6.23 | 6.97 | 3 | 2 | 0/7 | 0/7 |  |
| 140 | Greater Western Sydney v Fremantle | 6.19 | 6.95 | 3 | 2 | 0/7 | 0/7 |  |
| 139 | Hawthorn v Melbourne | 6.31 | 6.94 | 3 | 2 | 0/7 | 0/7 |  |
| 138 | West Coast v Adelaide | 6.16 | 6.90 | 3 | 2 | 0/7 | 0/7 |  |
| 137 | Sydney v Western Bulldogs | 6.16 | 6.96 | 3 | 2 | 0/7 | 0/7 |  |
| 136 | Geelong v Brisbane Lions | 6.26 | 6.90 | 3 | 2 | 0/7 | 0/7 |  |
| 132 | Collingwood v Richmond | 6.33 | 6.94 | 3 | 2 | 0/7 | 0/7 |  |
| 131 | Carlton v West Coast | 6.39 | 6.92 | 3 | 2 | 0/7 | 0/7 |  |
| 130 | Hawthorn v Greater Western Sydney | 6.13 | 6.94 | 3 | 2 | 0/7 | 0/7 |  |
| 129 | Brisbane Lions v Sydney | 6.31 | 6.93 | 3 | 2 | 0/7 | 1/7 |  |
| 128 | St Kilda v Western Bulldogs | 6.06 | 6.92 | 3 | 2 | 1/7 | 0/7 |  |
| 127 | Richmond v North Melbourne | 6.18 | 6.93 | 3 | 2 | 0/7 | 0/7 |  |
| 126 | Collingwood v Port Adelaide | 6.19 | 6.91 | 3 | 2 | 0/7 | 0/7 |  |

## Notes

- Odds from `odds_snapshots` when present, else `bookmaker_lines`; missing prices degrade to non-edge scoring (cushion/trend/leaders still apply).
- Last-game leaders need `player_game_stats` for prior completed fixtures; empty → no HOT bonus.
- Flat ROI uses model-implied odds on $1 stakes (not bookie P&L).
