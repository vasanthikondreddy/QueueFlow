# QueueFlow – Smart Queue Management System

Full-stack queue manager: managers log in, create queues, add people (auto-generated tokens `Q001`, `Q002`…), reorder, call the next token, complete or cancel, and watch live analytics. Updates are pushed to every open screen in real time.

**Stack:** React 18 + Vite + Tailwind + React Router + Axios + Recharts + Lucide · Node + Express + Socket.IO · MongoDB + Mongoose · JWT + bcrypt · Jest/Supertest + Vitest/React Testing Library

## Quick start

Prerequisites: Node 18+, a MongoDB (local or Atlas).

```bash
# 1) API
cd server
cp .env.example .env        # set MONGODB_URI and JWT_SECRET
npm install
npm run seed                # optional demo data: demo@queueflow.dev / Demo1234
npm run dev                 # http://localhost:5000

# 2) Web app (new terminal)
cd client
cp .env.example .env        # VITE_API_URL=http://localhost:5000
npm install
npm run dev                 # http://localhost:5173
```

Tests: `cd server && npm test` (uses an in-memory MongoDB, downloaded on first run) · `cd client && npm test`.

## Features → where they live

| Requirement | Implementation |
|---|---|
| Manager login / register | `authController`, JWT (7d), bcrypt (12 rounds), protected routes + APIs |
| Create queues with a name | `queueController`; names unique per manager; rename, activate/deactivate, delete |
| Add person → token created | `tokenService.addToken` – atomic counter, `Q001` format, WAITING, position, timestamp |
| Waiting list | `GET /queues/:id/tokens` returns waiting (ordered), serving, recent history, counts |
| Move up / down | `tokenService.reorder` – neighbour swap keeps positions contiguous |
| Assign top token for service | **CALL NEXT TOKEN** → `serveNext`; **Complete Service** → `complete` |
| Cancel a token | `cancel` (confirmation dialog in UI) |
| Analytics dashboard | `analyticsService` – 7 summary cards, 5 charts, Today / 7d / 30d filters |
| Real-time | Socket.IO, JWT-authenticated, rooms restricted to the queue owner |

## Business rules

* Token numbers are per-queue, increase forever and are **never reused** (cancel/complete don't free a number).
* Only **WAITING** tokens have a position (1…n, contiguous). Serving/completed/cancelled tokens have none.
* Only **one SERVING** token per queue. *Call next* is refused while someone is being served (`409 ALREADY_SERVING`) or when nobody waits (`409 QUEUE_EMPTY`).
* Only WAITING tokens can be **moved** or **cancelled**. A SERVING token cannot be cancelled – finish it with *Complete Service*. Completed/cancelled tokens are final.
* **Inactive** queues refuse new people and *call next*, but current work can still be completed/cancelled.
* A queue can only be **deleted when it has no WAITING/SERVING tokens**; deleting also removes its history and analytics events (confirmation required).
* **Waiting time** = `servingAt − createdAt`. **Service duration** = `completedAt − servingAt`. Averages use only COMPLETED tokens with present, correctly ordered timestamps.

## How consistency is kept under concurrency

Multiple requests (two managers' tabs, double clicks, retries) can hit one queue at once. Layers, from outermost in:

1. **Per-queue lock in MongoDB** (`utils/queueLock.js`). Every mutation acquires a lock with one atomic `findOneAndUpdate` (`lockedUntil`/`lockId`, 10 s TTL so a crashed request can't block forever). Contenders retry with jitter and get `409 QUEUE_BUSY` after 8 s. It works across several server instances, and doubles as the ownership check (other manager's queue → 404).
2. **Atomic token counter** – `$inc` on `Queue.nextTokenNumber`; each request receives a unique value.
3. **Database constraints as a backstop** (`models/Token.js`):
   * unique `(queueId, tokenNumber)`
   * **partial unique index `one_serving_per_queue`** on `{queueId}` where `status = 'SERVING'` → the DB itself rejects a second serving token
   * unique partial `(queueId, requestId)` → idempotency key sent by the UI, so retried/double-submitted "Add person" never creates two tokens
4. **Conditional updates** – state changes use `findOneAndUpdate({_id, status: 'SERVING'}, …)` so a token can't be completed or cancelled twice.
5. **Optimistic versioning** – `Queue.version` increments on every mutation. The UI sends the version it saw with each reorder; a stale view gets `409 STALE_QUEUE` and refreshes instead of moving the wrong token. The client also ignores any snapshot older than the one it has.
6. **UI** – a synchronous guard disables all actions while one is in flight (repeated clicks).

**Transactions / replica set:** this design deliberately does *not require* multi-document transactions, so it runs on a standalone local `mongod` as well as Atlas. If you prefer transactions (`session.withTransaction`), MongoDB needs a **replica set** – Atlas has one by default; locally run `mongod --replSet rs0` and `rs.initiate()`. The lock + unique indexes above would still be kept.

## Real-time

* Handshake needs a valid JWT; invalid/expired → connection refused.
* `queue:join` verifies in the DB that the queue belongs to the socket's user before joining room `queue:<id>`.
* The server emits `queue:updated` (full snapshot) **only after** the DB write succeeded. Client-sent events are never trusted as data changes.
* The client registers listeners once per queue (handlers kept in refs), removes them on cleanup, shows Live/Reconnecting, and refetches after a reconnect.

## Analytics

`QueueEvent` rows (`TOKEN_ADDED`, `TOKEN_SERVING`, `TOKEN_COMPLETED`, `TOKEN_CANCELLED`, `TOKEN_REORDERED`, `QUEUE_CREATED`) store the waiting count after every change, which drives the **queue-length trend** (end-of-period value + peak). Other charts are MongoDB aggregations bucketed in the browser's timezone (`tzOffset`). Empty datasets return zeros/`null` and show empty states. Today is bucketed hourly, 7d/30d daily.

## API

All responses: `{ success: true, data }` or `{ success: false, error: { message, code, details? } }`. Everything except register/login needs `Authorization: Bearer <jwt>`.

| Method & path | Purpose |
|---|---|
| POST `/api/auth/register`, `/api/auth/login` | Create account / log in (rate limited) |
| GET `/api/auth/me` · PUT `/api/auth/me` · POST `/api/auth/change-password` | Profile |
| POST/GET `/api/queues` · GET/PUT/DELETE `/api/queues/:queueId` | Queue CRUD (`PUT` takes `name` and/or `status`) |
| POST `/api/queues/:queueId/tokens` | `{ personName, requestId? }` → 201 |
| GET `/api/queues/:queueId/tokens` | Queue snapshot |
| PATCH `/api/queues/:queueId/tokens/reorder` | `{ tokenId, direction: "up"\|"down", version? }` |
| POST `/api/queues/:queueId/serve-next` | Call next token |
| POST `/api/queues/:queueId/tokens/:tokenId/complete` · `/cancel` | Finish / cancel |
| GET `/api/analytics/overview` · `/trends` · `/queues` | `?range=today\|7d\|30d&tzOffset=<min>&queueId=` |
| GET `/health` | Liveness + DB state |

Status codes: 400 validation / invalid id · 401 auth (`TOKEN_EXPIRED`, `INVALID_CREDENTIALS`) · 404 not found or not yours · 409 rule violation · 429 rate limit · 503 DB down.

## Security notes

bcrypt hashing (password never selected or returned) · JWT verification on every request and socket · ownership enforced in every query (`managerId`) · express-validator everywhere, string-typed fields + `express-mongo-sanitize` against NoSQL injection · Helmet · CORS allow-list · `10kb` body limit · auth rate limiting · centralized error handler (no stack traces/internals to clients, no request bodies in logs) · secrets only via env, `JWT_SECRET` ≥ 32 chars enforced in production · DB-down requests answer `503` instead of hanging.

**Token storage trade-off:** the JWT is kept in `localStorage` so login persists and works across Vercel (frontend) and Render (backend) domains, and for Socket.IO auth. It is exposed to XSS (React escapes output and no HTML is injected). A hardened alternative is an `httpOnly; Secure; SameSite=None` cookie, at the cost of third-party-cookie issues in Safari on split domains.

## Deployment

1. **MongoDB Atlas** – create a free cluster, a DB user, allow network access (0.0.0.0/0 for Render's dynamic IPs), copy the `mongodb+srv://…` URI.
2. **Backend on Render** – New Web Service from this repo, root dir `server`, build `npm install`, start `npm start` (or use `render.yaml`). Env: `MONGODB_URI`, `JWT_SECRET` (long random), `NODE_ENV=production`, `CLIENT_ORIGIN=https://<your-app>.vercel.app`. Health check `/health`. Note: Render's free tier sleeps – the first request after idling is slow.
3. **Frontend on Vercel** – import the repo, root dir `client`, framework Vite. Env: `VITE_API_URL=https://<your-api>.onrender.com`. `vercel.json` handles SPA routing.
4. Update `CLIENT_ORIGIN` on Render to the final Vercel URL (comma-separate multiple origins) and redeploy.

## Project structure

```
server/src  config · models · middleware · utils (lock, realtime) · services (token, analytics, events)
            controllers · routes · sockets · app.js · server.js
server/tests (auth, queues, tokens incl. concurrency, analytics) · server/scripts/seed.js
client/src  api · context (auth, toast) · hooks (socket) · components · pages · utils
client/tests (format, UI components, login/registration)
```

## Known limitations / ideas

* The lock is DB-based with a TTL; a request that runs longer than 10 s could lose its lock (the unique indexes still prevent corruption). Operations take milliseconds in practice.
* Reorder moves one step at a time (as specified); drag-and-drop would be a natural extension.
* Analytics are computed on demand; for very large histories add pre-aggregated daily rollups.
