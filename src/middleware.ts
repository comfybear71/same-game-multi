import withAuth from "next-auth/middleware";

// Protect everything except the login page, auth endpoints, cron endpoints
// (which authorise via CRON_SECRET) and static assets. Unauthenticated users
// are sent to the styled /login page rather than NextAuth's default.
export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    "/((?!login|api/auth|api/cron|_next/static|_next/image|favicon.ico).*)",
  ],
};
