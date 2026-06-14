import Link from "next/link";

import { SignOutButton } from "./SignOutButton";

const links = [
  { href: "/", label: "Fixtures" },
  { href: "/bets", label: "Bets" },
  { href: "/review", label: "Review" },
];

export function Nav({ email }: { email?: string | null }) {
  return (
    <header className="sticky top-0 z-10 border-b border-surface-border bg-surface/80 backdrop-blur">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-white">
          <span className="text-accent">●</span> AFL Multi Tracker
        </Link>
        <div className="flex items-center gap-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link">
              {l.label}
            </Link>
          ))}
          {email ? <SignOutButton /> : null}
        </div>
      </nav>
    </header>
  );
}
