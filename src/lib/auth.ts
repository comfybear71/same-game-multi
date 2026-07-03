import { eq } from "drizzle-orm";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { db } from "@/db";
import { users } from "@/db/schema";
import { isEmailAllowed } from "@/lib/env";

// ─────────────────────────────────────────────────────────────────────────────
// v1 auth: email-allowlist Credentials provider.
//
// This is intentionally lightweight for a solo/small-group tool: there is no
// open signup, and only emails present in ALLOWED_EMAILS can sign in. It is a
// gate, not bank-grade auth. The HANDOFF documents how to upgrade this to a
// proper Email magic-link or OAuth provider when you want stronger guarantees.
// ─────────────────────────────────────────────────────────────────────────────

export const authOptions: NextAuthOptions = {
  // Read directly from process.env (not the validating env proxy) so module
  // evaluation during `next build` doesn't throw when the secret is absent.
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email allowlist",
      credentials: {
        email: { label: "Email", type: "email" },
        name: { label: "Name (first time only)", type: "text" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        if (!email || !isEmailAllowed(email)) {
          return null;
        }

        // Upsert the user record so bets can be attributed.
        const existing = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        let user = existing[0];
        if (!user) {
          const inserted = await db
            .insert(users)
            .values({ email, name: credentials?.name || null })
            .returning();
          user = inserted[0];
        }

        return { id: String(user.id), email: user.email, name: user.name ?? null };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        (session.user as { id?: string }).id = token.userId as string;
      }
      return session;
    },
  },
};

/** Server-side helper to read the current session. */
export function auth() {
  return getServerSession(authOptions);
}
