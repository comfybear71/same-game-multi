export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Review &amp; forecasting</h1>
        <p className="text-sm text-slate-400">
          Predicted vs actual accuracy, model leaderboard, ROI and strike-rate
          over time.
        </p>
      </header>

      <section className="card">
        <h2 className="text-lg font-semibold text-white">Model leaderboard</h2>
        <p className="mt-1 text-sm text-slate-400">
          Once predictions are generated each round and games settle, this ranks
          models A/B/C by mean absolute error and within-tolerance hit rate per
          stat type (from the <code>model_accuracy</code> table). The most
          accurate model is highlighted to guide the following week.
        </p>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold text-white">ROI &amp; strike rate</h2>
        <p className="mt-1 text-sm text-slate-400">
          Line charts of cumulative ROI and weekly strike rate render here from
          settled bets. Charting is wired via Recharts.
        </p>
      </section>
    </div>
  );
}
