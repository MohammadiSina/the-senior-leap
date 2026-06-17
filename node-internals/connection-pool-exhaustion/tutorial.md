# Connection Pooling in Node.js

> Already comfortable with database connection pools and `pg.Pool`? Skip this and go straight to `README.md`.

---

Most Node.js applications don't connect to a database directly. They use a **connection pool** — a fixed set of reusable connections managed by a library like `pg` (PostgreSQL) or `mysql2` (MySQL).

---

## How It Works

A database connection is expensive to establish. TCP handshake, authentication, TLS negotiation — each one costs time and resources. If every incoming request opened a new connection and closed it when done, the database would spend more time managing connections than running queries.

A connection pool solves this by pre-establishing a small number of connections and lending them out on demand:

1. The app starts. The pool creates (up to) `max` connections.
2. A request arrives. The handler calls `pool.connect()` to **check out** a connection.
3. The handler runs its query.
4. The handler calls `client.release()` to **check the connection back in** to the pool.
5. The next request can reuse that same connection.

If all connections are checked out when a new request arrives, the request **waits** in a queue until one is released. It doesn't error immediately — it just sits there.

## The `pg.Pool` API

```js
const { Pool } = require('pg');

const pool = new Pool({
  max: 10,                    // Maximum concurrent connections
  connectionTimeoutMillis: 3000, // How long to wait for a connection before erroring
});

// Checkout a connection
const client = await pool.connect();
try {
  const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows;
} finally {
  client.release();  // Always return the connection, even if the query threw
}

// Shorthand — checkout, query, release in one call
const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
```

The `pool.connect()` / `client.release()` pattern is the manual version. `pool.query()` is a convenience wrapper that does the same thing internally. Use `pool.query()` when a route only needs one query. Use `pool.connect()` when you need to run multiple queries on the same connection (e.g., a transaction).

## Rules for Manual Pooling

When you use `pool.connect()` to manually check out a connection, you are taking a finite, shared resource out of circulation. Follow two strict rules:

**Rule 1: The return must be unconditional.**
You are borrowing the connection. If your query throws an error, you still owe the pool that connection. This is why `client.release()` must always live in a `finally` block. If an error causes your function to exit early and skip the release, that connection is lost to your app permanently. 

**Rule 2: Only hold the connection during database I/O.**
A connection should only be checked out for the exact milliseconds it takes to talk to the database. If you fetch data and then `await` a slow external API call *before* releasing the connection, you are hoarding a database resource while doing non-database work. Get your data, release the connection immediately, and *then* make your external calls.

## What to Watch For

- `pool.connect()` without a matching `client.release()` in a `finally` block is a leak waiting to happen. `try/catch` is not enough — `catch` handles the error but doesn't guarantee `release()` runs.
- `pool.query()` (the shorthand) handles checkout and release internally. You only need the manual pattern when you need multiple operations on the same connection.
- `connectionTimeoutMillis` controls how long a request waits for a connection before giving up. Without it, a drained pool means requests hang indefinitely instead of failing fast.
- `pool.idleCount` and `pool.waitingCount` (in `node-postgres`) are cheap diagnostics. Exposing them on a health endpoint is the fastest way to know if your pool is the bottleneck.

---

## Further Reading

- [node-postgres: Pooling](https://node-postgres.com/features/pooling) — The `pg` library's own guide to connection pooling.
- [node-postgres: Pool API](https://node-postgres.com/apis/pool) — Full API reference for `pg.Pool`.
