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

See **[Release workflow](#release-workflow-pr--merge--tag--sync)** below for the
full maintainer handoff (PR template, tag, Vercel, sync PC).

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

---

## Release workflow (PR → merge → tag → sync)

Standard procedure for Stuart (merge on GitHub) + Cursor (prepare PR + release
block). **Cursor does not auto-sync your PC** — step 5 is required after merge.

### 1. Cursor / agent (after code is ready)

- Work on a **feature branch** (not `master`).
- Run `typecheck`, `lint`, `build` when changes are non-trivial.
- Commit, push, open PR with `gh pr create`.
- Reply with the **handoff layout** below (same structure every time).

**Compare URL**
```
https://github.com/comfybear71/same-game-multi/compare/master...your-branch
```

**PR Title**
```
Short imperative title
```

**PR Description**
```markdown
## Summary
…

## Changes
- src/… — …

## Test plan
- [x] npm run typecheck && npm run lint && npm run build
- [ ] Vercel / manual …

PR: #NNN
```

**Merge instructions**
1. Open Compare URL (or PR #NNN)
2. Squash and merge
3. Delete branch
4. Sync PC: `git checkout master && git pull origin master && git fetch --prune`

**Release tag**

| Field | Value |
| --- | --- |
| Tag name | `v0.2.N-YYYY-MM-DD` |
| Target | `master` |
| Title | `v0.2.N — …` |
| Create via | `https://github.com/comfybear71/same-game-multi/releases/new?tag=…&target=master` |

**Release description**
```markdown
## v0.2.N

### Fixed
- …

### New
- …
```

**Tag format:** `v{major}.{minor}.{patch}-YYYY-MM-DD` (AWST calendar date).
Bump **patch** for fixes/small features; **minor** for larger features. Check
latest tag: `git tag -l --sort=-creatordate | head -1`.

### 2. Stuart on GitHub

1. Review PR → **Squash and merge** into `master`.
2. **Delete branch** (optional cleanup — does not trigger deploy).
3. **Releases → New release** → choose tag from handoff block (create tag on
   `master` if it does not exist) → paste title + description → Publish.

### 3. Vercel

- Deploys automatically when **`master` updates** (the squash merge push).
- Deleting the feature branch is unrelated to deploy timing.
- Check the Vercel dashboard if production looks stale (~1–2 min after merge).

### 4. Sync PC with GitHub (required)

GitHub and your PC are **not** mirrored until you pull (or ask Cursor to sync):

```bash
git checkout master
git pull origin master
git branch -d feature/your-branch    # if merged locally
git fetch --prune                    # drop deleted remote branches
```

After this, local `master` matches GitHub `master` and matches what Vercel
deployed.

### Quick checklist

| Step | Who | Done when |
| --- | --- | --- |
| PR opened + handoff block | Cursor | URL in chat |
| Squash merge | Stuart | PR closed, merged |
| Delete branch | Stuart | Branch gone on GitHub |
| GitHub Release + tag | Stuart | Tag visible under Releases |
| Vercel production | Automatic | Latest deploy from `master` |
| `git pull` on PC | Stuart or Cursor | `git status` on `master`, clean vs origin |

---

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
