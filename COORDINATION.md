# COORDINATION.md — Agent Collaboration Protocol

## Purpose

Prevent merge conflicts, duplicate work, and boundary violations between Icarus and Daedalus on the Sulcus monorepo. Both agents MUST read this file before starting any work session.

---

## 1. Territory Map

| Path | Owner | Notes |
|------|-------|-------|
| `crates/sulcus-core/` | Daedalus | Rust core logic, thermodynamics, graph |
| `crates/sulcus-server/` | Daedalus | Server routes, middleware, MCP handlers |
| `crates/sulcus-local/` | Daedalus | Local MCP transport, embedded PG |
| `crates/sulcus-server/tests/` | Daedalus | Server integration tests |
| `crates/sulcus-local/tests/` | Daedalus | Local integration tests |
| `packages/sulcus-web/` | Shared | Next.js dashboard, auth, UI — both agents work here |
| `packages/openclaw-sulcus/` | Icarus | OpenClaw memory plugin |
| `migrations/` | Shared | Coordinate before adding migrations |
| `Cargo.toml` / `Cargo.lock` | Shared | Coordinate — both sides touch these |
| `.github/` | Daedalus | CI/CD pipeline |
| `docker-compose*.yml` | Shared | Coordinate before changes |
| `AGENTS.md` | Daedalus | Rust architecture doc |
| `COORDINATION.md` | Shared | This file — both agents maintain |
| `OPENCLAW_SETUP.md` | Icarus | OpenClaw integration guide |

**Rule: For exclusive territories, do not commit without assignment from Dooley. For shared paths, coordinate via claims or fetch-before-commit to avoid conflicts.**

---

## 2. Pre-Work Protocol (MANDATORY)

Before starting any work on Sulcus, every agent MUST:

```
1. git fetch origin
2. git log --oneline origin/master -3
3. Check COORDINATION.md claims section (below)
4. If your planned work touches shared files → post in #sulcus first
5. If origin has commits you don't have → git pull before starting
```

Skipping these steps is how we get merge conflicts. Don't skip them.

---

## 3. Active Claims

Format: `| Agent | Scope | Started | Description |`

When starting work, add a row. When done, remove it.

| Agent | Scope | Started | Description |
|-------|-------|---------|-------------|
| — | — | — | No active claims |

**Claim rules:**
- Check for existing claims before starting work
- If another agent has a claim on overlapping files, do NOT start — coordinate first
- Claims expire after 24h if not updated
- Remove your claim when you push your commit

---

## 4. Commit Protocol

1. **Fetch before commit:** `git fetch origin && git log --oneline origin/master -1`
2. **If origin moved:** Rebase before pushing — `git pull --rebase origin master`
3. **Commit message prefix:** Include agent name — `[Icarus]` or `[Daedalus]`
4. **Push immediately:** Don't let local commits sit — push after each logical unit

---

## 5. Sync Cron Rules

The hourly Icarus-Daedalus sync cron:
- Reports ONLY when there's a delta (new commits, divergence, or conflicts)
- Silent when nothing changed since last check
- Alerts immediately on: divergence, territory violation, or merge conflict risk
- Does NOT spam #updates with "all clear" every hour

---

## 6. Completion Validation

When an agent declares a task "done", it must pass ALL of these:

### Code validation
- [ ] `cargo check` passes with zero errors
- [ ] `cargo test` passes (all crates)
- [ ] No merge conflicts with origin/master
- [ ] Changes pushed to origin

### Integration validation
- [ ] If server changes: `cargo run -p sulcus-server` starts without error
- [ ] If web changes: `cd packages/sulcus-web && npm run build` succeeds
- [ ] If migration changes: existing data not broken (test with populated DB)

### Process validation
- [ ] Commit is in your assigned territory (or explicitly assigned by Dooley)
- [ ] No active claims from the other agent on touched files
- [ ] Claim removed from this file after push
- [ ] Changes described in commit message (not just "fix stuff")

**A task is not done until all applicable checks pass. Saying "done" without validation is a bug.**

---

## 7. Conflict Resolution

If divergence is detected:
1. **Stop pushing.** Don't make it worse.
2. Post in #sulcus with: what diverged, which files, who has the better implementation
3. Dooley decides which version wins (or asks for a merge)
4. One agent resolves, the other waits
5. Both confirm clean state before resuming

---

## 8. Escalation

Flag to Dooley immediately if:
- Both agents touched the same file in the same hour
- A territory violation was committed (not just planned)
- Cargo test failures after a merge
- An agent pushed without fetching first (detectable via force-push or divergence pattern)
