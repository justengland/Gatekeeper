
# CLAUDE.md — Gatekeeper (CLI-first) — Agent-optimized Guidance
_Last updated: 2025-08-10_

This file tells **Claude Code** exactly how to work in this repo so the **Agent** is rock-solid and aligned with the new CLI-first task list.

---

## How Claude should work here (read this first)

1) **Use a TODO list and execute it sequentially.** After each step, **update the list** and mark items done.  
2) **Prefer “test → implement → refactor”.** Write a failing test, make it pass, then clean up.  
3) **Every task needs acceptance criteria** (tests green, files/paths changed, CLI output, or a git diff).  
4) **Ask clarifying questions only if truly blocking.** Otherwise make a reasonable assumption and continue.  
5) **Never log secrets.** Redact DSNs, passwords, and tokens in logs/tests.  
6) **Keep the Agent portable.** All DB actions must go through well-defined provider interfaces so MySQL/IAM can be added later without churn.

If you need a starter prompt, copy the one in `gatekeeper_cli_tasklist.md` (section “Claude Code — Todo Kickoff Prompt”).

---

## Project Overview

**Gatekeeper** mints **ephemeral database sessions** with time-limited access. Two services:

- **Control Plane**: REST API to receive session requests and dispatch jobs
- **Agent**: Executes DB operations (create/drop ephemeral credentials, grant roles, cleanup)

**Primary goal (Milestone 0):** Postgres-only vertical slice driven by a **CLI**. The Agent creates an ephemeral credential with a TTL and returns a DSN. A cleanup process removes expired users promptly.

---

## Tech & Repo Layout

- **Language**: TypeScript (strict)
- **Runtime**: Node.js 20 LTS
- **Packages**: pnpm + turbo monorepo
- **HTTP**: Express (or fastify), Zod validation
- **DB**: PostgreSQL 16 (Docker Compose) via `pg`
- **Tests**: Vitest, Testcontainers (Postgres), Pact (CP ⇄ Agent), k6 (smoke perf)
- **Logging**: pino (structured), correlation IDs
- **Tracing**: OpenTelemetry (optional in Milestone 0)

**Monorepo (expected)**
```
packages/
  shared/           # zod types, errors, util
  sdk/              # generated TS client from OpenAPI
  control-plane/    # REST API
  agent/            # job worker (local daemon simulating Lambda)
  cli/              # gk CLI
infra-dev/          # docker-compose, seeds, local scripts
docs/               # DECISIONS.md, AUDIT.md, etc.
```

---

## Common Commands (local)

```bash
# deps and local services
pnpm i
docker compose up -d postgres

# generate/openapi types (if present)
pnpm -w gen:openapi

# build/test everything
pnpm -w build
pnpm -w test
  3
# dev
pnpm --filter control-plane dev
pnpm --filter agent dev
pnpm --filter cli dev
```

**Postgres bootstrap (roles + helpers)**
```bash
docker exec -i rdsum-postgres psql -U postgres -d app   -v ON_ERROR_STOP=1 -f - < packages/agent/sql/bootstrap_roles.sql
```

**LocalStack Lambda testing (optional)**
```bash
# Start LocalStack with Lambda support
docker compose up -d localstack

# Package and deploy Agent as Lambda function
pnpm --filter agent build:lambda
pnpm --filter agent deploy:localstack

# Configure Control Plane to use LocalStack Lambda
export AGENT_MODE=lambda
export LAMBDA_ENDPOINT=http://localhost:4566
export LAMBDA_FUNCTION_NAME=gatekeeper-agent

# Run integration tests against Lambda
pnpm --filter agent test:lambda
```

---

## Configuration (.env)

- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` — Postgres connection for **Agent** admin role
- `CONTROL_PLANE_PORT` (default: 4000)
- `AGENT_PORT` (default: 4001) — local worker HTTP (if needed)
- `AGENT_POLL_INTERVAL_MS` (e.g., 500) — how often Agent polls the queue (local)
- `ROLEPACK_VERSION` (e.g., `pg-1.0.0`) — choose SQL templates
- `SESSION_MAX_TTL_MINUTES` (e.g., 240)
- `LOG_LEVEL` (`info` | `debug`)

**Lambda-specific (for LocalStack testing)**
- `AGENT_MODE` (`http` | `lambda`) — how Control Plane invokes Agent
- `LAMBDA_ENDPOINT` (e.g., `http://localhost:4566`) — LocalStack Lambda endpoint
- `LAMBDA_FUNCTION_NAME` (e.g., `gatekeeper-agent`) — Lambda function name
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — LocalStack credentials (test/test)

---

## Agent Responsibilities (Milestone 0)

**Create Session (happy path)**
1. Receive `CreateSessionJob` (JSON) from Control Plane.
2. Validate with Zod; attach correlation ID to logs.
3. In a single transaction:
   - Generate `username = gk_{shortuuid}` and a strong password.
   - `CREATE ROLE` (or `CREATE USER`) with `LOGIN` and `VALID UNTIL now() + ttl`.
   - Grant **Role Pack** (`app_read`) and set `search_path` if needed.
   - Optionally set `CONNECTION LIMIT 1` (configurable).
4. Return **DSN** (redacted in logs) + expiry timestamp.
5. Emit **AuditEvent**: `session.created` with hash-chain fields.

**Cleanup**
- Periodically query for expired or revoked sessions and **drop users**.
- Ensure idempotency: dropping a non-existent user should be a no-op.
- Emit `session.cleaned` events.

**Revocation**
- On `RevokeSessionJob`, drop credentials immediately, mark session as `revoked`.

**Error handling**
- Use typed errors; include `retryable: boolean`.
- Backoff with jitter for transient DB errors.
- Never partially apply grants—on failure, **rollback** the transaction.

---

## Job Contracts (CP ⇄ Agent)

**CreateSessionJob**
```ts
type CreateSessionJob = {
  id: string;                // idempotency key
  correlationId: string;
  target: DatabaseTarget;    // host, port, db, ssl
  role: "app_read";          // Milestone 0 scope
  ttlMinutes: number;        // 1..SESSION_MAX_TTL_MINUTES
  requester: { userId: string; email?: string };
  reason?: string;
};
```

**CreateSessionResult**
```ts
type CreateSessionResult = {
  sessionId: string;
  status: "ready" | "failed";
  dsn?: string;              // redact in logs
  expiresAt?: string;        // ISO
  error?: { code: string; message: string };
};
```

**RevokeSessionJob**
```ts
type RevokeSessionJob = {
  id: string;                // idempotency key
  correlationId: string;
  sessionId: string;
};
```

---

## Role Packs (PG)

Keep SQL in versioned templates under `packages/agent/sql/rolepacks/pg-1.0.0/`:

- `app_read.sql` — `SELECT` only
- `helpers.sql` — SECURITY DEFINER functions to encapsulate user management

**Example SECURITY DEFINER helpers (snippet)**
```sql
-- packages/agent/sql/rolepacks/pg-1.0.0/helpers.sql
CREATE OR REPLACE FUNCTION gk_create_ephemeral_user(u text, p text, valid_until timestamptz, role_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L VALID UNTIL %L', u, p, valid_until);
  EXECUTE format('GRANT %I TO %I', role_name, u);
END;
$$;

CREATE OR REPLACE FUNCTION gk_drop_user(u text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM 1 FROM pg_roles WHERE rolname = u;
  IF FOUND THEN
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', u);
    EXECUTE format('DROP ROLE %I', u);
  END IF;
END;
$$;
```

> **Important:** Install helpers with a privileged bootstrap role; application roles must not have direct `CREATE ROLE` privileges.

---

## Security Expectations

- **Least-privilege**: only a dedicated admin role can run the SECURITY DEFINER helpers.
- **Idempotency**: all jobs carry `id` (idempotency key). Re-creates should no-op or reconcile.
- **Input validation**: Zod on all external inputs (CLI → CP, CP → Agent).
- **Audit**: append-only events with a **hash chain** (include `prev_hash`).
- **Rate limits** on Control Plane; **backoff + jitter** on Agent.
- **Redaction**: secrets never appear in logs/tests.

---

## Tests (order to implement)

1. **Unit**: username generator, DSN builder, TTL math, Zod schemas.
2. **Integration (Testcontainers)**:
   - create session → can connect with DSN and `SELECT now()` succeeds
   - TTL expiry → connection fails, cleanup drops user
3. **Contract (Pact)**: CP ⇄ Agent payloads (Create/Result/Revoke)
4. **Smoke perf (k6)**: p99 create→ready < 6s on local stack

Target coverage for the slice: **≥85%** (Milestone 0).

---

## Observability

- **pino** logs with `correlationId` on every span.
- Optional: **OpenTelemetry** traces (http → job → db).
- **Metrics** (even simple counters): jobs processed, failures, cleanup lag, queue depth.

---

## Extensibility Notes (for future work)

- Introduce `DatabaseProvider` interface:
```ts
interface DatabaseProvider {
  createEphemeralUser(input: { role: string; ttlMinutes: number }): Promise<CreateSessionResult>;
  dropUser(username: string): Promise<void>;
  health(): Promise<"ok" | "degraded" | "down">;
}
```
- Add `MySQLProvider` parallel to `PostgresProvider` without touching the Agent orchestrator.
- Add **IAM token path** behind the same interface (no-password flow).

---

## API Surfaces (for CLI, Terraform, CloudFormation)

- Keep Control Plane endpoints simple and stable:
  - `POST /sessions` → `{ sessionId, status }`
  - `GET /sessions/:id` → `{ status, dsn?, expiresAt? }`
  - `POST /sessions/:id/revoke` → `{ status }`

Generate the SDK in `packages/sdk` so the CLI and any IaC tool can share the same client.

---

## Code Review Checklist (Agent)

- [ ] No secrets in logs (unit tests enforce redaction).
- [ ] All inputs validated with Zod; errors mapped to typed codes.
- [ ] Single-transaction user creation; rollback on error.
- [ ] SECURITY DEFINER helpers installed; app role lacks superuser rights.
- [ ] Idempotency respected; retries are safe.
- [ ] Tests present (unit+integration+contract); coverage meets target.
- [ ] Docs updated (`DECISIONS.md`, `AUDIT.md`).
- [ ] Performance gate: p99 create→ready within target; cleanup lag ≤ 2m p95.

---

## Known Non-goals (Milestone 0)

- MySQL and multi-tenant boundaries (coming later).
- IAM DB auth (interface stub only in Milestone 0).
- Web UI (CLI is the primary interface for this slice).

---

## Pitfalls to avoid

- Granting privileges directly to ephemeral users instead of via Role Packs.
- Allowing the app to call `CREATE ROLE` without a controlled SECURITY DEFINER function.
- Leaking DSNs/passwords in logs or test snapshots.
- Skipping idempotency keys; retries will create drift.

---

Happy path demo reminder (local):

```bash
gk session create --target pg-local --role app_read --ttl 15m --reason "debug"
psql "$DSN" -c "select now();"   # success
sleep 900
psql "$DSN" -c "select 1;"       # should fail (expired)
```

- the control plane api should fit into a single labda function using local stack for testing
- its better to use script from the package.json than complex cli calls for repeated tasks



- write the plan to a file called plan.md and make it a check list of what is complete.