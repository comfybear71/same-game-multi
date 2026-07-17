import Link from "next/link";

import { SignOutButton } from "./SignOutButton";

const links = [
  { href: "/", label: "Fixtures" },
  { href: "/bets", label: "Bets" },
  { href: "/system", label: "System" },
  { href: "/lab", label: "Lab" },
  { href: "/leaders", label: "Leaders" },
  { href: "/review", label: "Review" },
];

export function Nav({ email }: { email?: string | null }) {
  return (
    <header className="sticky top-0 z-20 border-b border-surface-border bg-surface/80 backdrop-blur">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-white">
          <span className="text-accent">●</span>
          <span>Matty&apos;s got big balls multi tracker</span>
        </Link>
        <div className="flex items-center gap-1">
          {/* Section links live in the bottom tab bar on mobile. */}
          <div className="hidden items-center gap-1 sm:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="nav-link">
                {l.label}
              </Link>
            ))}
          </div>
          {email ? <SignOutButton /> : null}
        </div>
      </nav>
    </header>
  );
}
