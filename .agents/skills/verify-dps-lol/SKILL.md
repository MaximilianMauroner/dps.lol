---
name: verify-dps-lol
description: Verify patch-pinned Yunara fixture simulation and disclosure. Use when checking changed simulation, worker optimization or local prototype access.
---

# Verify dps.lol

Read README.md, current route schemas and [features.md](features.md). Use an
isolated worktree with no DATABASE_URL, Riot or bucket credentials. Do not copy
.env.example values as working services. Generate disposable local prototype
`PROTOTYPE_ACCESS_PASSWORD` and `PROTOTYPE_SESSION_SECRET` in the launcher
environment; never copy production secrets.
Select only journeys affected by work in the requested audit window.
Check active work, host resources and port. Record revision, patch/data version,
mode and owned PID. Install `bun install --frozen-lockfile`.
Start `bun run dev -- --hostname 127.0.0.1 --port 43138` with the disposable auth.
Require login page HTTP readiness, protected API 401, then public login using the
owned password. Keep returned session cookie private and use a fresh browser context.

Prefer T3 preview; use headless fallback only after explicit native unavailable
or unsupported response. Selectors come from current page/snapshot. Run rows
serially with default fixture targets and public API responses. A fixture pass is
not stored Riot, live ingestion, Practice Tool or production archive proof.
Check readiness and reset owned app state before one targeted retry.
Supporting checks: `bun run format:check`, `bun run lint`, `bun run typecheck`,
`bun test`, `bun run build`. Record existing failures separately from procedure edits.

Never run db:migrate, data:sync, ingestion, reconcile/rebuild or bucket mutation
commands against shared resources. Database/archive journeys need a disposable
Postgres/bucket and explicit source scope. Stop owned server/workers, dispose owned
cookies/browser data/credentials and downloads, confirm port closed and retain
redacted response/trace evidence outside disposable state.
