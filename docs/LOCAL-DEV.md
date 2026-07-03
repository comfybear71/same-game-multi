# Local development workflow

Safe day-to-day workflow for feature branches, localhost testing, and merging to
`master`.

## One-time setup

```bash
npm install
npm run setup:local
```

Edit `.env.local` and fill in at minimum:

- `DATABASE_URL` — Neon **pooled** connection string
- `ALLOWED_EMAILS` — comma-separated emails allowed to sign in

Apply the database schema:

```bash
npm run db:migrate
```

If your Vercel project already has env vars configured:

```bash
vercel env pull .env.local
npm run setup:local   # fills any gaps (e.g. generates NEXTAUTH_SECRET)
```

## Daily workflow

### 1. Start from an up-to-date `master`

```bash
git checkout master
git pull origin master
```

### 2. Create a feature branch

Never commit directly to `master`. Use a descriptive branch name:

```bash
git checkout -b feature/short-description
```

Examples: `feature/bet-settlement-ui`, `fix/auth-redirect`.

### 3. Develop and test locally

```bash
npm run check:env   # optional but catches auth/DB config early
npm run dev
```

Open http://localhost:3000 and sign in with an email from `ALLOWED_EMAILS`.

Before opening a PR, run the full gate:

```bash
npm run typecheck
npm run lint
npm run build
```

### 4. Commit on your feature branch

```bash
git add -p                  # review hunks
git commit -m "Add bet settlement summary"
```

Keep commits focused. One logical change per commit when possible.

### 5. Push and open a PR to `master`

```bash
git push -u origin HEAD
gh pr create --base master --title "Your title" --body "..."
```

Describe what changed, why, and how you verified it (typecheck/lint/build,
manual steps).

### 6. Merge safely

- Wait for CI / review (if configured).
- Use **Squash and merge** or **Merge commit** on GitHub — do not force-push
  to `master`.
- After merge, delete the feature branch and pull fresh `master` locally:

```bash
git checkout master
git pull origin master
git branch -d feature/short-description
```

## Troubleshooting auth

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/api/auth/error?error=Configuration` | Missing `NEXTAUTH_SECRET` | `npm run setup:local` |
| `[next-auth][error][NO_SECRET]` | Same as above | Add secret to `.env.local`, restart dev server |
| "That email isn't on the allowlist" | Email not in `ALLOWED_EMAILS` | Add your email to `.env.local` |
| Sign-in succeeds then DB error | Missing/invalid `DATABASE_URL` | Check Neon connection string; run `npm run db:migrate` |

Restart `npm run dev` after any `.env.local` change — Next.js reads env at
startup.

## What never goes in git

- `.env.local`, `.env`, or any file with real secrets
- Vercel OIDC tokens (safe in `.env.local`, already gitignored)
- API keys pasted into source code — always use env vars from `.env.example`
