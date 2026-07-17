/** Shared collapsible card used on System / Lab / Review / game pages. */
export function CollapsibleSection({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="card group" open={defaultOpen || undefined}>
      <summary className="flex cursor-pointer list-none items-start gap-2">
        <span className="mt-1 shrink-0 text-slate-600 transition-transform group-open:rotate-90">
          ▸
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-slate-400">{description}</p>
          ) : null}
        </div>
      </summary>
      <div className="mt-3 border-t border-surface-border/60 pt-3">{children}</div>
    </details>
  );
}
