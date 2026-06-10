# Rubric — Event Loop Starvation

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.

---

## What a Senior Engineer Would Notice

Items are grouped by how much their absence reveals a gap in thinking.

---

### 🔴 Critical

**One synchronous operation blocked every other request — not just its own.**

Node.js runs JavaScript on a single thread. While `generateSummary` is executing — sorting 300,000 objects, traversing them, sorting again per category — the event loop cannot advance. No timers fire. No new network events are processed. No other callbacks run. Every request that arrives during those 300ms sits waiting in the kernel's socket buffer. `GET /health` isn't slow. It can't even respond yet. This is the correct diagnosis. "The report endpoint is slow" is an incomplete answer — the question is why a *different* endpoint is affected.

This distinction is the whole exercise. If your analysis stops at "the report is too slow," it's describing a symptom, not the mechanism.

---

**The libuv thread pool does not offload JavaScript computation.**

Node.js uses a worker pool (libuv, 4 threads by default) for a specific class of operations: `fs.*` system calls, `dns.lookup()`, some `crypto` functions, `zlib`. These are blocking OS calls that libuv runs on background threads so the main thread stays free.

It does not offload arbitrary JavaScript. Sorting an array, aggregating objects, computing statistics — this is V8 executing JavaScript, and it always runs on the main thread. Wrapping `generateSummary` in an `async` function or a `Promise` does not change this. `async` describes how Node waits for I/O; it does not move computation to another thread. An `async` function that does 300ms of CPU work still blocks the event loop for 300ms before yielding.

This is one of the most persistent misconceptions in Node.js development, and the exercise is designed specifically to surface it.

---

### 🟡 Important

**The timestamp sort is the dominant cost — and it wasn't necessary.**

`[...events].sort((a, b) => a.ts - b.ts)` is O(n log n) on 300,000 elements. Sorting 300k objects by a numeric key takes 150–400ms on most machines — it's the majority of the blocking time. The developer added it thinking the report needed chronological ordering. It doesn't: per-category aggregation works on any order. The sort is both the most expensive operation *and* an unnecessary one. A senior identifying only "the sort is slow" misses half the point; identifying that it's also *avoidable* is the stronger observation.

---

**Two real fixes exist, and they have different tradeoffs worth knowing.**

*`setImmediate` chunking* breaks the computation into pieces, scheduling each chunk with `setImmediate` so the event loop can fire other callbacks between chunks. Health checks get through. The tradeoff: each yield adds overhead, and the total report latency increases — you're trading report speed for event loop responsiveness. Acceptable for infrequent, latency-tolerant reports.

*`worker_threads`* moves the entire computation to a separate V8 thread. The main thread is never touched. Report latency is unchanged. Health checks respond instantly. The tradeoff: architectural complexity — you need to serialize data into the worker, handle message passing, manage the worker's lifecycle. For genuinely CPU-bound work that runs frequently or must be fast, this is the right answer.

A senior can name both, explain the tradeoffs, and say which they'd apply here and why. "We should cache the result" is a valid *operational* fix but doesn't answer the question of why the current code blocks.

---

### 🟢 Bonus

**This pattern is detectable in production before it becomes a crisis.**

Tracking p99 latency across *all* routes — not just the slow ones — is the signal. When a CPU-bound route is in heavy use, p99 of every other route climbs together. That correlation is specific: it doesn't look like database contention (which shows up differently) or memory pressure. Node's `perf_hooks` API can measure event loop lag directly. Tools like [Clinic.js](https://clinicjs.org) (specifically `clinic doctor`) are built to diagnose exactly this pattern.

---

**The `load.js` output shows more than one delayed health check — that burst is itself a clue.**

When the server unblocks, all the health checks that queued during the block resolve at nearly the same moment. The output shows a cluster of `⚠` lines arriving together, then normal latency resuming. That pattern — a sudden burst of delayed responses rather than a gradual recovery — is specific to event loop starvation. Gradual slowdowns look different. A senior reading logs would recognize the burst as a signature.

---

## Common Mistakes

**Making the route `async` and expecting it to help.** This is the most common wrong fix. It changes nothing about when or where the computation runs. The blocking is in the JavaScript, not in any I/O wait.

**Diagnosing only the report endpoint.** "The report is slow, we should cache it or paginate it" addresses the frequency of blocking but not the mechanism. It also doesn't explain why the health check is affected — which is the actual question.

**Missing the unnecessary sort.** Noticing that `generateSummary` blocks is one thing. Noticing that the most expensive part of it (the full array sort) isn't even needed for the output is the sharper observation. The fix isn't just "make it non-blocking" — it's "fix the algorithm, then decide if non-blocking scheduling is still needed."

**Attributing it to the thread pool.** A common misconception is that Node.js offloads heavy computation to background workers automatically. It doesn't. The thread pool exists for specific system calls — not for JavaScript. If your diagnosis includes "this should have been handled by libuv's thread pool," the rubric's second critical item is what you missed.
