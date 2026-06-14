# AFL Multi Tracker

Mobile-first + desktop web app for **AFL same-game multi** prediction and bet
tracking. Solo / small-group tool. **AFL only.** All times shown in AWST (Perth).

Stack: Next.js 14 (App Router, TS) · Neon Postgres + Drizzle · NextAuth ·
Tailwind · Recharts · deployed on Vercel.

See **CLAUDE.md** for architecture/conventions and **HANDOFF.md** for current
status and what's next.

---

## Local development

Run these one at a time.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `.env.local` (see **Environment variables** below). At minimum you need
`DATABASE_URL` and `NEXTAUTH_SECRET` to boot.

Generate a NextAuth secret:

```bash
openssl rand -base64 32
```

Apply the database schema to your Neon database:

```bash
npm run db:migrate
```

Start the dev server:

```bash
npm run dev
```

Open http://localhost:3000 and sign in with an email listed in
`ALLOWED_EMAILS`.

Before committing, these must all pass:

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run build
```

---

## Neon (Postgres) setup

One step at a time.

1. Create an account at https://neon.tech and click **New Project**.
2. Name the project (e.g. `afl-multi-tracker`) and pick the region closest to
   your Vercel deployment region.
3. After it's created, open **Connection Details**.
4. Select the **Pooled connection** and copy the connection string. It looks
   like:
   ```
   postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/DB?sslmode=require
   ```
5. Put that value in `DATABASE_URL` (in `.env.local` for local, and in Vercel
   for production).
6. Apply the schema:
   ```bash
   npm run db:migrate
   ```

---

## Vercel setup

One step at a time.

1. Push this branch to GitHub.
2. Go to https://vercel.com → **Add New… → Project** → import the repo.
3. Framework preset auto-detects **Next.js**. Leave build settings default
   (`next build`).
4. Before the first deploy, add the environment variables (next section) under
   **Settings → Environment Variables**. Add them to **Production** (and
   **Preview** if you use preview deploys).
5. Set `NEXTAUTH_URL` to your production URL, e.g.
   `https://your-app.vercel.app`.
6. Click **Deploy**.
7. Create a **Vercel Blob** store: **Storage → Create → Blob**. Copy the
   generated `BLOB_READ_WRITE_TOKEN` into the project env vars (used for bet
   screenshot uploads).
8. **Cron jobs** are defined in `vercel.json` and are picked up automatically:
   - `refresh-fixtures` — daily fixtures + odds sync.
   - `settle-results` — morning-after results + bet settlement.
   Optionally set `CRON_SECRET` (env var) to lock the cron endpoints.
9. Redeploy if you added env vars after the first deploy.

> Branch protection: protect `master` and merge feature branches via PR. Do not
> deploy from `master` until the skeleton is reviewed.

---

## Environment variables

All listed in `.env.example`. Never commit real values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon pooled Postgres connection string. |
| `NEXTAUTH_SECRET` | yes | NextAuth JWT signing secret (`openssl rand -base64 32`). |
| `NEXTAUTH_URL` | prod | App base URL (e.g. `https://your-app.vercel.app`). |
| `ALLOWED_EMAILS` | yes | Comma-separated allowlist of sign-in emails. |
| `ODDS_API_KEY` | for odds | The Odds API paid key (player props). Never hardcode. |
| `BLOB_READ_WRITE_TOKEN` | for uploads | Vercel Blob token for screenshots. |
| `CRON_SECRET` | optional | Locks the cron endpoints. |
| `SQUIGGLE_CONTACT` | optional | User-Agent contact string for Squiggle. |

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Local dev server. |
| `npm run build` | Production build. |
| `npm run start` | Run the production build. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | `next lint`. |
| `npm run db:generate` | Generate a migration from `schema.ts`. |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL`. |
| `npm run db:studio` | Open Drizzle Studio. |
