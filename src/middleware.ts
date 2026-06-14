export { default } from "next-auth/middleware";

// Protect everything except the login page, auth endpoints, cron endpoints
// (which authorise via CRON_SECRET) and static assets.
export const config = {
  matcher: [
    "/((?!login|api/auth|api/cron|_next/static|_next/image|favicon.ico).*)",
  ],
};
