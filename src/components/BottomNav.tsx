"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Mobile-only bottom tab bar. Hidden on sm+ where the header links take over.

const tabs = [
  { href: "/", label: "Fixtures", icon: CalendarIcon, exact: true },
  { href: "/bets", label: "Bets", icon: TicketIcon, exact: false },
  { href: "/system", label: "System", icon: BoltIcon, exact: false },
  { href: "/lab", label: "Lab", icon: FlaskIcon, exact: false },
  { href: "/leaders", label: "Leaders", icon: StarIcon, exact: false },
  { href: "/review", label: "Review", icon: ChartIcon, exact: false },
];

export function BottomNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-border bg-surface sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-5xl">
        {tabs.map((t) => {
          const active = t.exact
            ? pathname === t.href
            : pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              prefetch={false}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
                active ? "text-accent" : "text-slate-400"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z" />
    </svg>
  );
}

function FlaskIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 3h6M10 3v6.5L4.5 19a2 2 0 0 0 1.7 3h12a2 2 0 0 0 1.7-3L14 9.5V3" />
      <path d="M8.5 14h7" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3v18h18" />
      <path d="M7 14l3-3 3 3 4-5" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m12 3 2.5 6.5L21 10l-5 4.5L17.5 21 12 17.5 6.5 21 8 14.5 3 10l6.5-.5L12 3Z" />
    </svg>
  );
}
