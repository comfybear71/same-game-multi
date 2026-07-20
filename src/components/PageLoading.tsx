/** Instant soft-nav feedback while force-dynamic RSC pages hit Neon. */

export function PageLoading({
  title = "Loading…",
  cards = 4,
}: {
  title?: string;
  cards?: number;
}) {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label={title}>
      <header className="space-y-2">
        <div className="h-7 w-40 rounded bg-surface-card" />
        <div className="h-4 w-72 max-w-full rounded bg-surface-card/80" />
      </header>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="card h-16">
            <div className="h-3 w-16 rounded bg-surface-border/60" />
            <div className="mt-3 h-6 w-12 rounded bg-surface-border/40" />
          </div>
        ))}
      </section>
      <div className="card space-y-3">
        <div className="h-4 w-48 rounded bg-surface-border/50" />
        <div className="h-3 w-full rounded bg-surface-border/30" />
        <div className="h-3 w-4/5 rounded bg-surface-border/30" />
        <div className="h-24 w-full rounded bg-surface-border/20" />
      </div>
    </div>
  );
}
