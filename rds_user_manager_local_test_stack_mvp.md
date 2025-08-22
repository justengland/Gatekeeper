# RDS User Manager — Local Test Stack (MVP)

This guide sets up a **local development and test stack** for the RDS User Manager MVP using:

- **PostgreSQL** in a Docker container (for testing)
- **Docker Compose** (to run the DB)
- **TypeScript** for both the control-plane web API and the customer "agent" (Lambda-like) service

The local stack simulates the production model:

- **Control Plane (web app/API)**: Receives requests to create ephemeral DB sessions and forwards a job to the **Agent**.
- **Agent**: Executes SQL against Postgres to create a short-lived user, grants a role, and returns a DSN.

.. note:: For local development we run the database inside Docker and the Node/TypeScript services on your machine. In production, the agent will be packaged as a Lambda; locally we run it as a small HTTP service that mimics Lambda job handling.

## Prerequisites

- Docker and Docker Compose
- Node.js **>= 18** (20 LTS recommended) and npm (or pnpm/yarn)
- `psql` client (optional but handy)

## Repository Layout (single package)

.. code-block:: text

rds-user-manager/ ├─ docker-compose.yml ├─ .env.example ├─ package.json ├─ tsconfig.json ├─ src/ │  ├─ control-plane/ │  │  └─ server.ts │  ├─ agent/ │  │  └─ server.ts │  ├─ sql/ │  │  └─ bootstrap\_roles.sql │  └─ types.ts └─ test/ └─ session.spec.ts

## Step 1 — Clone and enter the repo

.. code-block:: bash

git clone  rds-user-manager cd rds-user-manager

## Step 2 — Create the Docker Compose file (Postgres)

Create `docker-compose.yml`:

.. code-block:: yaml

services: postgres: image: postgres:16 container\_name: rdsum-postgres environment: POSTGRES\_USER: postgres POSTGRES\_PASSWORD: postgres POSTGRES\_DB: devdb ports: - "5432:5432" healthcheck: test: ["CMD", "pg\_isready", "-U", "postgres"] interval: 5s timeout: 3s retries: 20 volumes: - pgdata:/var/lib/postgresql/data volumes: pgdata:

Start Postgres:

.. code-block:: bash

docker compose up -d postgres

Wait for healthy:

.. code-block:: bash

docker compose ps

## Step 3 — Environment variables

Create `.env.example`:

.. code-block:: dotenv

# Postgres connection for AGENT (admin user for local dev)

PGHOST=localhost PGPORT=5432 PGDATABASE=devdb PGUSER=postgres PGPASSWORD=postgres

# Control plane configuration

CONTROL\_PLANE\_PORT=4000

# Agent configuration

AGENT\_PORT=4001

# Control plane tells Agent via HTTP in local mode

AGENT\_INTERNAL\_URL=[http://localhost:4001](http://localhost:4001)

Copy to `.env` and adjust if needed:

.. code-block:: bash

cp .env.example .env

## Step 4 — Bootstrap roles in Postgres

Create `src/sql/bootstrap_roles.sql`:

.. code-block:: sql

\-- Create minimal roles for tests (database name is devdb by default) CREATE ROLE app\_read; GRANT CONNECT ON DATABASE devdb TO app\_read; GRANT USAGE ON SCHEMA public TO app\_read; GRANT SELECT ON ALL TABLES IN SCHEMA public TO app\_read; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app\_read;

CREATE ROLE app\_write; GRANT app\_read TO app\_write; GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app\_write; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT, UPDATE, DELETE ON TABLES TO app\_write;

Apply the SQL inside the Postgres container:

.. code-block:: bash

docker exec -i rdsum-postgres psql -U postgres -d devdb \
-v ON\_ERROR\_STOP=1 -f - < src/sql/bootstrap\_roles.sql

## Step 5 — TypeScript project files

`package.json`:

.. code-block:: json

{ "name": "rds-user-manager-local", "private": true, "type": "module", "scripts": { "dev": "npm-run-all --parallel dev\:agent dev\:api", "dev\:api": "ts-node-dev --respawn src/control-plane/server.ts", "dev\:agent": "ts-node-dev --respawn src/agent/server.ts", "test": "vitest run --reporter=verbose" }, "dependencies": { "axios": "^1.6.0", "dotenv": "^16.4.0", "express": "^4.19.0", "pg": "^8.11.0", "zod": "^3.22.0" }, "devDependencies": { "@types/express": "^4.17.21", "@types/node": "^20.0.0", "npm-run-all": "^4.1.5", "supertest": "^7.0.0", "ts-node-dev": "^2.0.0", "typescript": "^5.4.0", "vitest": "^1.3.0" } }

`tsconfig.json`:

.. code-block:: json

{ "compilerOptions": { "target": "ES2022", "module": "ES2022", "moduleResolution": "Node", "strict": true, "esModuleInterop": true, "skipLibCheck": true, "outDir": "dist", "rootDir": "." }, "include": ["src", "test"] }

`src/types.ts`:

.. code-block:: typescript

export type CreateSessionJob = { cmd: "create\_session"; db: string;            // database name, e.g., "devdb" role: "app\_read" | "app\_write"; ttlMinutes: number;    // e.g., 45 requestedBy: string;   // email or id };

export type DropUserJob = { cmd: "drop\_user"; db: string; username: string; };

export type AgentJob = CreateSessionJob | DropUserJob;

export type AgentResult = { status: "ok" | "error"; message?: string; dsn?: string; expiresAt?: string; username?: string; };

## Step 6 — Agent (local Lambda mimic)

`src/agent/server.ts`:

.. code-block:: typescript

import "dotenv/config"; import express from "express"; import { randomBytes } from "crypto"; import { Client } from "pg"; import type { AgentJob, AgentResult } from "../types.js";

const app = express(); app.use(express.json());

const PG = { host: process.env.PGHOST || "localhost", port: Number(process.env.PGPORT || 5432), database: process.env.PGDATABASE || "devdb", user: process.env.PGUSER || "postgres", password: process.env.PGPASSWORD || "postgres", };

function newUsername() { const id = randomBytes(6).toString("hex"); // 12 chars return `rdsum_${id}`; }

function newPassword() { return randomBytes(18).toString("hex"); // 36 chars }

async function withClient(dbName: string, fn: (c: Client) => Promise): Promise { const c = new Client({ ...PG, database: dbName }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }

app.post("/jobs", async (req, res) => { const job = req.body as AgentJob; try { if (job.cmd === "create\_session") { const username = newUsername(); const password = newPassword(); const ttl = Math.max(1, Math.min(240, job.ttlMinutes)); const expiresAtIso = new Date(Date.now() + ttl \* 60\_000).toISOString();

```
     await withClient(job.db, async (c) => {
       // CREATE USER ... VALID UNTIL ... ; GRANT role
       await c.query(`CREATE USER ${username} WITH PASSWORD $1 VALID UNTIL NOW() + INTERVAL '${ttl} minutes'`, [password]);
       await c.query(`GRANT ${job.role} TO ${username}`);
     });

     const dsn = `postgres://${username}:${encodeURIComponent(password)}@${PG.host}:${PG.port}/${job.db}?sslmode=disable`;
     const result: AgentResult = { status: "ok", dsn, expiresAt: expiresAtIso, username };
     return res.json(result);
   }

   if (job.cmd === "drop_user") {
     await withClient(job.db, async (c) => {
       await c.query(`DROP USER IF EXISTS ${job.username}`);
     });
     const result: AgentResult = { status: "ok" };
     return res.json(result);
   }

   return res.status(400).json({ status: "error", message: "unknown command" });
 } catch (e: any) {
   return res.status(500).json({ status: "error", message: e.message });
 }
```

});

const port = Number(process.env.AGENT\_PORT || 4001); app.listen(port, () => console.log(`[agent] listening on :${port}`));

.. warning:: This demo uses simple string interpolation for identifiers (username, role). In production, validate and safely quote identifiers; use roles that you control.

## Step 7 — Control Plane (local web API)

`src/control-plane/server.ts`:

.. code-block:: typescript

import "dotenv/config"; import express from "express"; import axios from "axios"; import { z } from "zod"; import type { AgentResult, CreateSessionJob, DropUserJob } from "../types.js";

const app = express(); app.use(express.json());

const AgentURL = process.env.AGENT\_INTERNAL\_URL || "[http://localhost:4001](http://localhost:4001)";

const CreateSchema = z.object({ db: z.string().min(1), role: z.enum(["app\_read", "app\_write"]), ttlMinutes: z.number().int().min(1).max(240), requestedBy: z.string().email().or(z.string().min(1)), });

app.post("/api/sessions", async (req, res) => { const parse = CreateSchema.safeParse(req.body); if (!parse.success) return res.status(400).json({ error: parse.error.flatten() }); const job: CreateSessionJob = { cmd: "create\_session", ...parse.data };

```
 const r = await axios.post(`${AgentURL}/jobs`, job, { timeout: 15_000 });
 const result = r.data as AgentResult;
 if (result.status !== "ok") return res.status(502).json(result);
 // Here you would persist an audit row. For local dev we just echo.
 return res.json(result);
```

});

const DropSchema = z.object({ db: z.string().min(1), username: z.string().min(1) }); app.post("/api/sessions/drop", async (req, res) => { const parse = DropSchema.safeParse(req.body); if (!parse.success) return res.status(400).json({ error: parse.error.flatten() }); const job: DropUserJob = { cmd: "drop\_user", ...parse.data }; const r = await axios.post(`${AgentURL}/jobs`, job, { timeout: 15\_000 }); return res.json(r.data); });

const port = Number(process.env.CONTROL\_PLANE\_PORT || 4000); app.listen(port, () => console.log(`[api] listening on :${port}`));

## Step 8 — Install dependencies and run

.. code-block:: bash

npm install npm run dev

This starts both services:

- Control Plane API: `http://localhost:4000`
- Agent service: `http://localhost:4001`

## Step 9 — Create a session (manual test)

Request an ephemeral user (TTL 30 minutes, read-only):

.. code-block:: bash

curl -s [http://localhost:4000/api/sessions](http://localhost:4000/api/sessions) \
-H 'Content-Type: application/json' \
-d '{ "db": "devdb", "role": "app\_read", "ttlMinutes": 30, "requestedBy": "[dev@example.com](mailto\:dev@example.com)" }' | jq

Expected response (shape):

.. code-block:: json

{ "status": "ok", "dsn": "postgres\://rdsum\_ab12cd:\*\*\*@localhost:5432/devdb?sslmode=disable", "expiresAt": "2025-08-09T17:30:00.000Z", "username": "rdsum\_ab12cd" }

## Step 10 — Verify the user can connect

Use the returned DSN or run a quick query with the ephemeral user (replace username and password):

.. code-block:: bash

PGPASSWORD= psql "host=localhost port=5432 dbname=devdb user= sslmode=disable" -c "SELECT current\_user, now();"

You should see `current_user` set to the ephemeral username.

## Step 11 — Drop the user (manual revoke)

.. code-block:: bash

curl -s [http://localhost:4000/api/sessions/drop](http://localhost:4000/api/sessions/drop) \
-H 'Content-Type: application/json' \
-d '{ "db": "devdb", "username": "" }' | jq

## Step 12 — Automated tests (Vitest)

Create `test/session.spec.ts`:

.. code-block:: typescript

import { afterAll, beforeAll, expect, test } from "vitest"; import request from "supertest"; import { Client } from "pg";

const API = "[http://localhost:4000](http://localhost:4000)";

const PG = { host: process.env.PGHOST || "localhost", port: Number(process.env.PGPORT || 5432), database: process.env.PGDATABASE || "devdb", user: process.env.PGUSER || "postgres", password: process.env.PGPASSWORD || "postgres", };

async function canConnectAs(user: string, pass: string) { const c = new Client({ ...PG, user, password: pass }); await c.connect(); const r = await c.query("select current\_user"); await c.end(); return r.rows[0].current\_user === user; }

let createdUser = ""; let password = "";

test("create session and connect", async () => { const res = await request(API) .post("/api/sessions") .send({ db: "devdb", role: "app\_read", ttlMinutes: 15, requestedBy: "[test@example.com](mailto\:test@example.com)" }) .expect(200);

```
 expect(res.body.status).toBe("ok");
 createdUser = res.body.username;

 // Extract password from DSN for the test
 const dsn: string = res.body.dsn;
 password = decodeURIComponent(dsn.split("://")[1].split(":")[1].split("@")[0]);

 const ok = await canConnectAs(createdUser, password);
 expect(ok).toBe(true);
```

});

afterAll(async () => { if (createdUser) { await request(API).post("/api/sessions/drop").send({ db: "devdb", username: createdUser }).expect(200); } });

Run the test (ensure `npm run dev` is running in another terminal):

.. code-block:: bash

npm test

## Troubleshooting

- **Postgres not reachable**: Confirm `docker compose ps` shows healthy; check port `5432` not used by another local Postgres.
- **Role missing**: Ensure you ran `bootstrap_roles.sql` and that you are connecting to the correct database (`devdb`).
- **EADDRINUSE**: Ports 4000/4001 in use; change `CONTROL_PLANE_PORT` / `AGENT_PORT` in `.env`.
- **Password characters**: We URL-encode in the DSN; use the exact `dsn` value or decode carefully.

## Next Steps (after MVP)

- Replace local Agent HTTP with **SQS-driven Lambda** in the customer account.
- Add **expiry scheduler** in the control plane to enqueue `drop_user` at TTL.
- Introduce **audit storage** (SQLite/Postgres/DynamoDB) in control plane.
- Add **MySQL** parity and a minimal web UI for requesting access.

## Teardown

.. code-block:: bash

docker compose down -v

