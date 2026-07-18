# Portfolio fill backtest — greedy vs snake draft

**Generated:** 2026-07-18T08:45:21.930Z
**Season:** 2026 · **Games:** 25
**Flag:** Reviewed and flipped **ON** by default (Jul 2026). Set `PORTFOLIO_DRAFT_FILL=off` to revert.

## Gate (HANDOFF.md)

| Check | Greedy | Best draft (λ=4) | Pass? |
|-------|--------|----------------------------------|-------|
| Effective independent bets ↑ | 5.02 | 6.54 | YES |
| Max appearances ↓ | 3.92 | 2.36 | YES |
| Quiet-star nights (flat $1 return) | 4.59 (4 nights) | 8.29 | ok |

**Overall gate: PASS** — ready for maintainer to consider flipping the flag.

## λ sweep

| λ | Eff. bets | Max apps | Overlap | Slip hit | Flat ROI | Quiet-star $ |
|---|-----------|----------|---------|----------|----------|--------------|
| greedy | 5.02 | 3.92 | 0.283 | 18.0% | -68.3% | 4.59 |
| 4 ← recommend | 6.54 | 2.36 | 0.066 | 15.5% | -71.1% | 8.29 |
| 8 | 6.76 | 2.12 | 0.035 | 12.5% | -76.9% | 5.85 |
| 12 | 6.85 | 1.92 | 0.021 | 11.5% | -78.1% | 5.95 |

**Recommended λ = 4** (clears diversification gate; prefers quiet-star $ then slip hit).

## Per-game (λ=8 sample)

| Game | Fixture | Greedy eff | Draft eff | Greedy max | Draft max | Greedy hits | Draft hits | Quiet star |
|------|---------|------------|-----------|------------|-----------|-------------|------------|------------|
| 154 | Geelong v St Kilda | 5.33 | 7.00 | 4 | 1 | 0/8 | 0/8 |  |
| 147 | St Kilda v Port Adelaide | 4.67 | 6.78 | 4 | 2 | 0/8 | 0/8 |  |
| 146 | Collingwood v North Melbourne | 4.67 | 6.78 | 4 | 2 | 4/8 | 2/8 |  |
| 145 | Fremantle v Sydney | 6.00 | 6.56 | 3 | 2 | 0/8 | 0/8 | yes |
| 144 | Port Adelaide v North Melbourne | 6.00 | 6.89 | 3 | 2 | 2/8 | 1/8 | yes |
| 143 | Essendon v St Kilda | 3.78 | 7.00 | 6 | 1 | 0/8 | 1/8 | yes |
| 142 | Richmond v Carlton | 5.67 | 6.67 | 3 | 2 | 4/8 | 3/8 |  |
| 141 | Gold Coast v Collingwood | 5.00 | 6.78 | 3 | 2 | 0/8 | 0/8 |  |
| 140 | Greater Western Sydney v Fremantle | 5.25 | 6.64 | 5 | 3 | 0/8 | 0/8 |  |
| 139 | Hawthorn v Melbourne | 5.44 | 7.00 | 3 | 1 | 0/8 | 0/8 |  |
| 138 | West Coast v Adelaide | 5.00 | 6.89 | 3 | 2 | 0/8 | 0/8 |  |
| 137 | Sydney v Western Bulldogs | 3.67 | 6.78 | 5 | 2 | 0/8 | 2/8 |  |
| 136 | Geelong v Brisbane Lions | 5.00 | 6.89 | 4 | 2 | 5/8 | 3/8 |  |
| 132 | Collingwood v Richmond | 4.67 | 6.89 | 4 | 2 | 5/8 | 4/8 |  |
| 131 | Carlton v West Coast | 6.14 | 6.47 | 3 | 3 | 2/8 | 0/8 |  |
| 130 | Hawthorn v Greater Western Sydney | 3.33 | 6.67 | 5 | 2 | 0/8 | 0/8 |  |
| 129 | Brisbane Lions v Sydney | 5.65 | 6.48 | 4 | 3 | 0/8 | 0/8 |  |
| 128 | St Kilda v Western Bulldogs | 4.71 | 6.67 | 5 | 3 | 0/8 | 1/8 |  |
| 127 | Richmond v North Melbourne | 4.67 | 6.78 | 4 | 2 | 7/8 | 3/8 |  |
| 126 | Collingwood v Port Adelaide | 4.67 | 6.67 | 4 | 2 | 2/8 | 1/8 |  |
| 125 | Greater Western Sydney v Carlton | 5.51 | 6.55 | 4 | 3 | 0/8 | 0/8 |  |
| 124 | Adelaide v Melbourne | 5.00 | 6.78 | 4 | 2 | 0/8 | 1/8 | yes |
| 123 | Gold Coast v Hawthorn | 5.33 | 6.89 | 3 | 2 | 0/8 | 0/8 |  |
| 122 | Fremantle v Geelong | 4.67 | 6.78 | 4 | 2 | 5/8 | 3/8 |  |
| 121 | St Kilda v Greater Western Sydney | 5.62 | 6.59 | 4 | 3 | 0/8 | 0/8 |  |

## Notes

- Exposure unit = player + market; FUN excluded from caps/metrics.
- Quiet-star = rounds where the most-cloned greedy exposure missed its line.
- Actuals from Lab `backtest_legs` (and `player_game_stats` when present).
- Flat ROI uses model-implied odds (no bookie prices) on $1 stakes.
- Reviewed: draft fill enabled by default (`PORTFOLIO_DRAFT_FILL=off` to revert).
