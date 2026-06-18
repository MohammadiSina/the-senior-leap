# Rubric — Thread Pool Saturation

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.

---

## What a Senior Engineer Would Notice

Items are grouped by how much their absence reveals a gap in thinking.

---

### 🔴 Critical

**`/login` and `/avatar/:id` are coupled through a resource neither of them mentions.**

`crypto.pbkdf2` (the async form, used in `/login`) and `fs.readFile` (used in `/avatar/:id`) are both dispatched to libuv's thread pool — by default, four OS threads, shared by the entire process. Nothing in the avatar route imports or calls anything related to auth. The coupling isn't in the code; it's in the runtime. A burst of password hashing occupies threads that file reads also need, and vice versa.

This is the core mechanism, and it's the part that's genuinely surprising the first time you see it: two features can be completely decoupled at the code level and still take each other down under load. If your analysis identifies that `/login` is slow because hashing is expensive, but doesn't explain why `/avatar/:id` — which does no hashing — is *also* slow, you've found the symptom in one route and missed the mechanism connecting both.

---

**Low CPU usage does not mean nothing is CPU-bound.**

`pbkdf2` with a realistic iteration count is genuinely expensive — it's real CPU work, not I/O wait. But it happens on one of four background threads, not the main thread, and on a machine with 8 or 16 cores, four busy threads can read as an unremarkable 20–30% on a top-level CPU graph. The instinct "CPU looks fine, so it's not a CPU problem" is exactly backwards here: the work is real, it's just distributed thin enough across cores to be invisible at the granularity most dashboards show by default.

This is different from `event-loop-starvation`, where a busy main thread *would* show as a CPU spike concentrated on a single core. Telling these apart — "the CPU graph looks calm" doesn't mean "no CPU-bound work is happening," it means "no CPU-bound work is happening *on the main thread*, or not enough of it to dominate the average" — is a distinction that separates reading metrics from understanding what they measure.

---

**`/health` and `/weather` staying fast is the differential diagnosis, and it rules out the main thread.**

`/health` does no I/O at all. `/weather` simulates a network call with `setTimeout`, which is scheduled by the event loop directly and never touches the thread pool. Both keep responding on schedule throughout the load test — which means the event loop itself is free. If this were `event-loop-starvation` (a busy main thread), *every* route would degrade together, including these two, because the JavaScript engine itself would be occupied. Here, only the two routes that specifically dispatch work to the thread pool are affected.

A senior reads "some things are slow, but a JS-only route and a timer-based route are both fine" as ruling out an entire category of bug (main-thread blocking) before even looking at the code. That's a fast, cheap diagnostic step that most engineers skip because they jump straight to "the server is under load" without asking *which* part of the server.

---

### 🟡 Important

**`UV_THREADPOOL_SIZE` is read once, early, and can't be changed once the pool exists.**

The pool is initialized lazily, the first time something needs it — but in practice, the only reliable way to size it is setting the environment variable before the process starts (`UV_THREADPOOL_SIZE=8 node index.js`). Setting `process.env.UV_THREADPOOL_SIZE` inside your own application code is fragile: if anything earlier in the require chain already triggered a thread-pool call, your assignment is a no-op, silently. A senior knows this isn't a runtime knob — it's a startup-time one.

Raising it also isn't a free win. More threads costs memory and scheduling overhead, and for CPU-bound work like `pbkdf2`, you get no benefit past your physical core count — you're not waiting on I/O, you're waiting on a CPU that doesn't exist. It's a legitimate mitigation with a ceiling, not an architecture fix.

---

**There's no built-in way to see this happening — and knowing that absence is itself useful.**

Unlike a database connection pool (`pool.idleCount`, `pool.waitingCount`), libuv exposes no equivalent for its thread pool from plain JavaScript. The `/debug/inflight` endpoint in this exercise is a homegrown approximation — it tells you how many calls *this app* dispatched and hasn't heard back from, not how many OS threads are actually busy, and it says nothing about other consumers in the same process (zlib, dns.lookup elsewhere) that you didn't think to track. A senior treats it as a useful signal, not a ground truth, and knows the actual tool for this job is `clinic bubbleprof`, not a custom counter.

---

### 🟢 Bonus

**The architectural fix doesn't touch the route that "broke."**

The right fix moves password hashing into a small, dedicated `worker_threads` pool — separate from libuv's shared pool entirely. The avatar route's code doesn't change at all. It was never the problem; it was only ever sharing a resource with something that was. Noticing that the fix for an observed symptom lives entirely in a different, unrelated route is a sharper read than "make the avatar route faster," which treats the symptom as the bug.

---

**The credential-stuffing framing is its own, separate, worth-fixing problem.**

Rate-limiting `/login` wouldn't fix the thread pool coupling — a smaller number of legitimate logins could still collide with avatar traffic under enough load. But it's worth doing anyway, independently: a service that runs full-cost password verification on every unauthenticated guess, with no rate limit, has a second problem that happens to be adjacent to this one but isn't the same bug. A senior names both rather than treating the rate limiter as "the fix."

---

## Common Mistakes

**Assuming "non-blocking" means "unlimited concurrency."** `fs.readFile` and `crypto.pbkdf2` not blocking the main thread is true and also not the whole story — they're non-blocking *for the caller*, but the actual work still has to run somewhere, and that somewhere is a pool of exactly four threads by default.

**Confusing this with `event-loop-starvation`.** Both present as "things are slow." The tell is which things: event loop starvation blocks everything, including routes that do no I/O at all. Thread pool saturation only blocks routes that specifically dispatch to the pool — a pure-JS route or a timer-based route sails through untouched.

**Treating `fs` and `crypto` as separate, unrelated subsystems.** They look like they belong to different parts of Node's API surface, and at the JavaScript level they are. Underneath, for the specific functions in this exercise, they're drawing from the exact same finite resource.

**Stopping at "raise `UV_THREADPOOL_SIZE`."** It's a real mitigation and worth knowing, but it raises a ceiling without removing the coupling — enough load will still saturate a bigger pool, and now two unrelated features are still sharing a queue, just a longer one.

**Trying to fix the avatar route.** Profiling `/avatar/:id` in isolation looks fine — a 150KB file read is fast. The bug only appears when login traffic is also present, which makes it easy to go looking for the problem in the route that's visibly slow and miss that the actual fix is somewhere else entirely.
