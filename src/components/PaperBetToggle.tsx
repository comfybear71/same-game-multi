"use client";

export function PaperBetToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-400">
      <input
        type="checkbox"
        className="mt-0.5 rounded border-surface-border"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Paper / what-if — not on Sportsbet. Remove anytime from Bets; strike rate
        &amp; ROI ignore these.
      </span>
    </label>
  );
}
