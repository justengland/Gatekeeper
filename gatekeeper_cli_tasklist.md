
# Gatekeeper RDS User Manager — **CLI‑first Task List** (downloadable)
_Last updated: 2025‑08‑10_

This file gives you:
1) A **Claude Code kickoff prompt** (paste it at the start of a session).  
2) A **sequenced task list** for a CLI‑first vertical slice.  
3) **Two additional ideas/tracks** you can pick up later.

---

## 1) Claude Code — Todo Kickoff Prompt (copy/paste)

You are working on **Gatekeeper (CLI-first)**. Create and execute a **todo list** to ship a vertical slice.

**Goal:** Ship a Postgres‑only vertical slice where a **CLI** requests an ephemeral DB session for a target, agent creates credentials, returns a DSN, and a cleanup process expires the session on TTL.

**Constraints:**
- Break work into **5–20 minute** steps.
- After each step, **update the todo list** and mark items done; continue sequentially.
- Each task must include **acceptance criteria** (tests passing, files changed, CLI output, or git diff).
- Prefer **“test → implement → refactor.”**
- Use **TypeScript** (strict), Vitest, Zod; local dev via Docker Compose.
- Postgres first; MySQL is out of scope for this slice.
- Security first: validate inputs, least‑privilege SQL, no plaintext secrets in logs.

**Artifacts to maintain during the session:**
- `docs/DECISIONS.md` (short bullets per major decision)
- `docs/AUDIT.md` (what is logged and why)
- `CHANGELOG.md` (keep‑a‑changelog style)

Now: **generate the todo list** and start at the top, asking clarifying questions only if absolutely blocking. 

---

## 2) CLI‑First Vertical Slice — Sequenced Task List

> Scope: PG‑only, single role (`app_read`), single tenant, agent runs as a local worker (simulates Lambda). CLI issues session requests and prints a DSN to connect. Expired sessions are cleaned up by a scheduled job.

### 2.1 Repo scaffolding & shared types
- [ ] **Scaffold monorepo** with `pnpm` + `turbo`: packages `cli/`, `control-plane/`, `agent/`, `shared/`, `infra-dev/`  
  **AC:** `pnpm build` and `pnpm test` succeed; TS strict mode enabled.
- [ ] **Shared Zod types**: `SessionRequest`, `Session`, `DatabaseTarget`, `RoleSpec`, `AuditEvent`  
  **AC:** Types compiled and consumed by both services; sample decode tests pass.
- [ ] **OpenAPI spec** for control plane: `POST /sessions`, `GET /sessions/:id`, `POST /sessions/:id/revoke`  
  **AC:** CI generates TS client SDK (`packages/sdk`) from spec.

### 2.2 Local infrastructure
- [ ] **Docker Compose**: Postgres 16 with healthcheck & init SQL (role pack: `app_read`)  
  **AC:** `pg_isready` healthy; seed script runs idempotently.
- [ ] **Local queue** (in‑memory first) with a simple job schema `CreateSessionJob`  
  **AC:** Unit tests: enqueue → agent consumes → ack.

### 2.3 Control plane (minimal)
- [ ] **Session create**: validate request, persist in memory, enqueue `CreateSessionJob`, return `pending`  
  **AC:** Vitest covers happy path + invalid inputs.
- [ ] **Session get**: returns `pending|ready|expired` + DSN when ready  
  **AC:** Contract tests (Pact) for CP ⇄ Agent JSON schema.
- [ ] **Revoke**: marks session for early cleanup  
  **AC:** Integration test toggles to `revoked` and triggers agent cleanup.

### 2.4 Agent (local worker simulating Lambda)
- [ ] **Create ephemeral credential** (PG): choose one path
  - Path A (preferred when IAM unavailable locally): **create user with `VALID UNTIL`** + grant `app_read`
  - Path B (when IAM auth used later): prepare code paths & interfaces
  **AC:** Connecting with issued DSN succeeds in test; role limited to SELECT only.
- [ ] **Cleanup**: drop expired users (TTL) and any revoked sessions  
  **AC:** Expired sessions disappear within **≤ 2 minutes** of TTL.

### 2.5 CLI (DX first)
- [ ] `gk login` (local dev profile) and `gk session create --target pg-local --role app_read --ttl 15m --reason "debug"`  
  **AC:** stdout prints DSN + expiry time; JSON output with `--json`.
- [ ] `gk session list` and `gk session revoke <id>`  
  **AC:** Commands wired; idempotent revoke.
- [ ] **Shell completion & config** (`~/.gatekeeper/config.toml`)  
  **AC:** Autocomplete for commands/flags; multiple profiles supported.
- [ ] **Telemetry hooks (opt‑in)**: correlation IDs and timing per command  
  **AC:** Logs have `trace_id`; redaction checked in tests.

### 2.6 Security & guardrails
- [ ] **Input validation** (Zod) at CLI & API edges  
  **AC:** Fuzz tests for dangerous inputs; reject on invalid.
- [ ] **Least‑privilege SQL** via `SECURITY DEFINER` helpers (PG) for create/drop  
  **AC:** Only the helper role can manage users; application role cannot.
- [ ] **Audit events** on all mutating actions (append‑only)  
  **AC:** Hash chain computed and verified in tests.

### 2.7 Tests & CI
- [ ] **Unit & integration** (Vitest + Testcontainers for PG)  
  **AC:** >85% coverage for this slice.
- [ ] **Contract tests** (Pact) for CP ⇄ Agent payloads  
  **AC:** Breaking changes are caught in CI.
- [ ] **Smoke perf** (k6 minimal) for `create → ready` latency  
  **AC:** p99 < 6s on local stack.

### 2.8 Done demo
- [ ] **Demo script**: `pnpm dev:stack` (compose up + workers + CP), then:
  ```bash
  gk session create --target pg-local --role app_read --ttl 15m
  psql "$DSN" -c "select now();"  # succeeds
  sleep 900
  psql "$DSN" -c "select 1;"      # fails (expired)
  ```
  **AC:** You can run the script end‑to‑end on a fresh machine in <10 minutes.

---

## 3) Packaging & DX (short track after the slice)
- [ ] **Homebrew tap** and **Scoop** manifests  
  **AC:** `brew install gatekeeper` works on macOS; Scoop on Windows.
- [ ] **Release automation**: version, changelog, SBOM  
  **AC:** GitHub Action publishes binaries for macOS/Linux (x64 & arm64).

---

## 4) Two Additional Ideas (pick up as separate tracks)

### Idea A — **TUI Mode** (ncurses‑style dashboard)
Rationale: power users live in terminals but want a live view.

- [ ] Add `gk tui` using `blessed/ink` (or `neo-blessed`)  
  **AC:** Panels for active sessions, copy DSN, revoke action.
- [ ] Live refresh via SSE/WebSocket to control plane  
  **AC:** Updates push without polling; falls back to poll.
- [ ] Inline **policy preview**: shows why a role request would be denied  
  **AC:** Hover/select target → see computed RBAC and max TTL.
- [ ] Color‑blind‑friendly defaults; minimal mouse support  
  **AC:** a11y lint passes; configurable keybindings.

### Idea B — **GitOps Mode** (declarative sessions)
Rationale: teams want ephemeral DB access tied to reviewed code changes.

- [ ] Define `SessionRequest` CRD‑like YAML (no Kubernetes required)  
  **AC:** `gk apply -f session.yaml` creates/updates sessions.
- [ ] **Policy as Code**: RBAC rules in HCL/YAML with validation  
  **AC:** `gk policy validate` catches conflicts & privilege escalations.
- [ ] CI integrations (GitHub Actions/GitLab) to mint sessions per job  
  **AC:** Example workflow checked in `examples/ci/` that runs tests with ephemeral DSN.
- [ ] Drift detection & garbage collection  
  **AC:** `gk reconcile` removes leaked/expired sessions safely.

---

## 5) Local Dev Setup (quick reference)
```bash
# prerequisites
brew install pnpm docker
pnpm i
docker compose up -d postgres

# dev loop
pnpm -w build
pnpm -w test
pnpm -w dev
```

---

## 6) Acceptance Gates for the Vertical Slice
- p99 session issuance < **6s** (local stack)
- Cleanup lag p95 < **2m** after TTL
- CLI JSON output stable (semver‑guarded) and documented
- Audit coverage 100% of mutating actions, with a verified hash chain
