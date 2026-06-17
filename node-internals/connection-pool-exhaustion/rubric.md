# Rubric — Connection Pool Exhaustion

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.

---

## What a Senior Engineer Would Notice

Items are grouped by how much their absence reveals a gap in thinking.

---

### 🔴 Critical

**The `/orders` handler leaks a connection every time the query throws.**

`client.release()` sits after the query, outside any `try/finally`. On the happy path — the query succeeds — the connection is released and everything works. But when `client.query()` throws (a constraint violation, a deadlock, a network blip), the function throws before reaching `release()`. The connection is gone from the pool permanently. Each failure costs one connection. After enough failures, the pool empties.

This is a monotonic leak. It does not recover. It only gets worse. And it's insidious because it *requires errors to manifest* — in testing, where inputs are clean and errors are rare, the happy path runs every time and the leak never fires. In production, with real data and real failure rates, each 500 response quietly bleeds a connection. Low error rate, long uptime, and eventually the pool drains from accumulated failures nobody was watching.

The fix is unconditional release in a `finally` block, not a `catch` block. `try/catch` handles the error but does not guarantee `release()` runs if the catch itself rethrows or if the error handling logic has its own early returns. `try/finally` guarantees the connection returns to the pool regardless of outcome — success, error, or anything in between.

---

**The `/profile/:id` handler holds a connection while doing unrelated work.**

After querying the database, the handler awaits an external recommendation API call (500–2000ms) while still holding the checked-out connection. The connection is idle during this entire wait — no queries are running on it — but it's unavailable to every other request in the system.

Under low concurrency this is invisible. Under load, 20 concurrent profile requests each pin a connection for 1.5 seconds on average, while the pool has 10 connections total. The pool exhausts after the first 10 requests arrive. The remaining 10 wait. And wait. And the next batch of 20 arrives. Nothing is technically broken — every connection gets released eventually — the system is just architected to need more concurrent connections than it has.

The fix is to release the connection immediately after the query completes, then make the external call with the connection already returned. Or restructure the code so the external call doesn't happen inside the connection's checkout window.

---

**The `/health` endpoint staying fast while database routes hang is the diagnostic — and it's specific.**

This is the differential diagnosis that separates pool exhaustion from event loop starvation. In event loop starvation, *everything* blocks — including `/health`, which never touches the database — because the main thread itself is busy. In pool exhaustion, the event loop is idle, perfectly free to handle health checks, while requests pile up waiting for a resource that has nothing to do with the CPU.

A senior reads "everything is slow" and "only DB routes are slow, health checks are instant" as two completely different bugs. The first instinct — "the database is overloaded" — is wrong in an instructive way: the database's own metrics look fine, because the bottleneck is in the application's connection management, not in the database's query execution. Checking `pool.idleCount` and `pool.waitingCount` (or the `/pool-stats` endpoint) confirms the diagnosis in seconds.

---

### 🟡 Important

**`pool.query()` (the shorthand) would have avoided the leak entirely for single-query routes.**

`pool.query(text, params)` checks out a connection, runs the query, and releases the connection internally — always in a `finally` block. For routes that only need one query, using the shorthand eliminates the manual checkout/release cycle and with it the entire category of leak bugs. The manual `pool.connect()` / `client.release()` pattern is only necessary when you need multiple operations on the same connection (e.g., `BEGIN` / queries / `COMMIT` transactions). Knowing when to use which pattern is a senior habit.

---

**`connectionTimeoutMillis` converts a silent hang into an observable error.**

Without it, a drained pool means requests wait indefinitely — no error, no log, just a client that eventually times out on its side (30 seconds, 60 seconds, whatever the client's timeout is). Setting `connectionTimeoutMillis: 3000` (or whatever is appropriate for the service's SLA) means the pool itself throws a clear error after a bounded wait. The request fails fast with a 500 and a useful message. The server logs show "Connection request timed out" — an error that points directly at pool exhaustion.

This is most of what separates "this paged someone at 3am with a useful message" from "this paged someone at 3am with nothing." Converting a silent hang into a fast-failing error with a clear cause is an observability decision, not just a timeout config.

---

### 🟢 Bonus

**Exposing pool stats on a health endpoint is cheap, high-value production diagnostics.**

`pool.idleCount`, `pool.totalCount`, `pool.waitingCount`, and (with a small wrapper) timeout counts are free to read. Exposing them on `/healthz` or `/metrics` — the same way the EventEmitter exercise exposed `listenerCount()` — gives ops an instant signal: "the pool is drained" vs. "the database is slow" vs. "something else entirely." Without this, diagnosing pool exhaustion in production requires either attaching a debugger or reading application logs for timeout errors, both of which take longer and require more context.

---

**The leak is probabilistic in testing — and that's the point.**

With a 10% query failure rate, the pool drains in roughly 100 requests. With a 1% failure rate, it takes 1,000. With 0.1%, it takes 10,000. In staging, where failure rates are low and uptime is short (restarts for deploys, config changes), the pool may never visibly drain. In production, with long uptime and real-world error rates, the accumulated leaks eventually hit the limit. A senior understands that "it works in staging" is not evidence that a monotonic leak doesn't exist — it's evidence that staging's error rate and uptime aren't high enough to surface it yet.

---

## Common Mistakes

**Diagnosing only one bug.** Finding the leak in `/orders` and stopping there misses the hold-too-long in `/profile/:id`. They look identical from the outside — "the pool is exhausted" — but they have different mechanisms and different fixes. A senior identifies both.

**Proposing `try/catch` as the fix for the leak.** Catching the error handles the error response, but `catch` doesn't guarantee `release()` runs. If the catch block rethrows, returns early, or has its own control flow, the connection is still leaked. `try/finally` is the correct pattern — unconditional release regardless of outcome.

**Attributing the hang to the database.** "The database is slow" is the most natural first diagnosis and it's wrong. The database's own metrics are fine. The application has run out of connections to give it. The distinction matters because the fix is completely different: database slow → optimize queries, add indexes, scale the DB. Pool exhausted → fix connection lifecycle, resize the pool, add timeouts.

**Confusing pool exhaustion with event loop starvation.** Both present as "requests are slow." But event loop starvation blocks *everything*, including health checks and static routes, because the main thread is busy. Pool exhaustion only blocks routes that need a database connection. The event loop is idle. A `/health` check that doesn't touch the database responds instantly under pool exhaustion and times out under event loop starvation. That one data point tells you which bug you're looking at.

**Missing that the external API call in `/profile` is the problem, not the database query.** The database query takes 5–100ms. The external API call takes 500–2000ms. The connection is held for the full duration of both. Under load, the external API call is what pins the connection — not the query. Noticing that the slow part has nothing to do with the database is the sharper observation.
