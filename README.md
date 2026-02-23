# Mini Table

A high-performance Airtable-style grid — MarTech take-home task.

## Quick Start

```bash
docker-compose up
```

| Service  | URL                          |
|----------|------------------------------|
| Frontend | http://localhost:3000        |
| BFF      | http://localhost:3001/health |
| Postgres | localhost:5432               |

On first boot the BFF auto-generates **50,000 rows** of synthetic data.  
To reset: `docker-compose down -v && docker-compose up`

---

## Architecture

```
Browser A          Browser B          Browser C
  │  HTTP fetch        │  HTTP fetch       │
  │  WebSocket ←───────┼───────────────────┘ cell-updated
  ↓                    ↓
BFF Node #1        BFF Node #2          (scale with Nginx)
  │  emit              │  emit
  └──────┐     ┌───────┘
         ↓     ↓
       Redis (pub/sub)          ← message broker
         │
         ↓
     PostgreSQL
```

When BFF #1 handles a `PATCH`, it writes to Postgres and publishes to Redis.  
The `@socket.io/redis-adapter` delivers the event to BFF #2, which relays it to all clients connected to that node.

### Frontend

| Concern              | Solution                                    |
|----------------------|---------------------------------------------|
| Table management     | **TanStack Table** (`useReactTable`)        |
| Large dataset render | **TanStack Virtual** (`useVirtualizer`)     |
| Data loading         | **Infinite scroll** — 150 rows per fetch    |
| Realtime sync        | **socket.io-client** — `cell-updated` event |
| Optimistic updates   | Local state patched immediately; server confirms async |
| Column visibility    | TanStack `VisibilityState` + localStorage   |
| Column reorder       | TanStack `ColumnOrderState` + drag & drop + localStorage |
| Inline editing       | text · number (`impressions`) · select (`status`) |

### BFF

- **Express** HTTP server wrapped in `node:http` `createServer`
- **socket.io** attached to the same HTTP server
- `PATCH /api/rows/:id` → writes to DB → calls `io.emit('cell-updated', row)` — all connected clients receive the update instantly
- Parameterised queries (no SQL injection risk)

### Database

Single table `creative_tasks` with 20 TEXT columns + `SERIAL` primary key.  
All columns are TEXT for simplicity (mirrors a flexible spreadsheet model).

---

## Key Decisions (ADRs)

### ADR-1 · Virtualisation over pagination

**Decision:** `useVirtualizer` renders only the DOM nodes currently visible in the viewport (~10–30 rows), regardless of how many rows are loaded in memory.

**Why:** Pagination adds friction (clicks, loss of scroll position). Virtualisation gives the user a seamless infinite-scroll experience while keeping DOM size constant at ~30 nodes even with 50,000 rows loaded.

### ADR-2 · Infinite scroll fetch strategy

**Decision:** Fetch 150 rows at a time; trigger next fetch when the user is within 600 px of the bottom.

**Why:** A single fetch of 50,000 rows blocks the main thread for a noticeable moment. Incremental fetching keeps the UI responsive and Time-to-First-Row under 200 ms.

### ADR-3 · Redis as message broker for realtime sync

**Decision:** socket.io uses `@socket.io/redis-adapter` backed by **Redis 7** pub/sub.

**Why:** When multiple BFF instances sit behind Nginx, a `PATCH` on Node #1 must reach clients connected to Node #2. The Redis adapter publishes every `io.emit()` to a Redis channel; all other nodes subscribe and relay the event to their own sockets — transparent to the application code.

**Fallback:** If Redis is unreachable on startup, the adapter call is skipped and socket.io falls back to in-memory mode (single-node only). This makes Redis a soft dependency — the app still runs in development without it.

**Trade-off:** Adds one more service to the docker-compose stack, but `redis:7-alpine` is ~30 MB and starts in under a second.

### ADR-4 · Optimistic updates

**Decision:** Cell value is updated in local React state immediately on user action, before the HTTP PATCH completes.

**Why:** Eliminates perceived latency — the UI feels instant. On error the stale value would need a rollback (currently not implemented — see Limitations).

### ADR-5 · All TEXT columns

**Decision:** All 20 data columns are stored as `TEXT` in PostgreSQL.

**Why:** Matches a real spreadsheet / Airtable model where column types evolve over time. Coercion to number/date happens at the application layer.

---

## Limitations & Trade-offs

- **No rollback on failed PATCH** — optimistic update stays even if the server returns an error.
- **Redis single instance** — for production, Redis itself should be clustered/replicated for HA.
- **No row-level locking** — two users editing the same cell simultaneously → last write wins.
- **No search / filter** — not in scope for this task, but easy to add via a `WHERE` clause in the BFF.
- **Column drag in settings panel only** — columns cannot be reordered by dragging the table headers directly.
