"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  Configuration:
    "Auth is misconfigured. Set NEXTAUTH_SECRET in .env.local (run npm run setup:local), then restart the dev server.",
  AccessDenied: "That email isn't on the allowlist.",
  CredentialsSignin: "That email isn't on the allowlist.",
};

function LoginForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";
  const authError = params.get("error");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(
    authError ? (AUTH_ERROR_MESSAGES[authError] ?? "Sign-in failed. Try again.") : null,
  );
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", {
      email,
      name,
      redirect: false,
    });
    if (res?.error) {
      setLoading(false);
      setError("That email isn't on the allowlist.");
      return;
    }
    // Hard navigation so the server-rendered layout/nav re-reads the new
    // session immediately (avoids needing a manual page refresh).
    window.location.assign(callbackUrl);
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="card">
        <h1 className="mb-1 text-xl font-bold text-white">Matty&apos;s got big balls multi tracker</h1>
        <p className="mb-4 text-sm text-slate-400">
          Invite-only. Sign in with an allowlisted email.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            className="input"
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            type="text"
            placeholder="Name (first time only)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error ? <p className="text-sm text-accent-loss">{error}</p> : null}
          <button className="btn w-full" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
