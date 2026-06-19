# Rubric — Microtask Queue Starvation

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.

---

## What a Senior Engineer Would Notice

Items are grouped by how much their absence reveals a gap in thinking.

---

### 🔴 Critical

**`process.nextTick` does not yield to I/O — it yields to the next callback in the same queue.**

The nextTick queue (and the Promise microtask queue) is drained to completion before the event loop is allowed to advance to its next phase. A recursive `process.nextTick` chain — where each callback schedules the next one before returning — keeps that queue permanently non-empty. The event loop never reaches the poll phase, which is where incoming HTTP data is read off the socket and request handlers are invoked. `/health` requests arrive at the OS and sit in the kernel's TCP receive buffer for the entire job duration. The server is not blocking in the conventional sense — V8 is constantly returning control between chunks, no single synchronous call holds the thread — but poll-phase starvation is the same outcome as if it were.

The engineer's reasoning ("I'm yielding between chunks, so the event loop can breathe") was not wrong about yielding — it was wrong about *where* it yields to.

---

**The correct fix is `setImmediate`, and the reason matters.**

`setImmediate` schedules callbacks in the check phase, which comes *after* the poll phase in each event loop iteration. Replacing `process.nextTick` with `setImmediate` means every chunk is separated by a complete loop iteration: the poll phase runs, pending I/O callbacks fire (including queued `/health` responses), and only then does the next chunk begin. This is not a minor implementation detail — it is the structural property that makes the fix correct.

An analysis that identifies "use `setImmediate`" without explaining why — or that recommends `setImmediate` as a general heuristic without connecting it to the phase ordering — is incomplete. The distinction is the lesson.

---

### 🟡 Important

**Promise microtasks have the same problem, and `async/await` does not escape it.**

Replacing `process.nextTick` with `await Promise.resolve()` or `await new Promise(r => r())` does not fix the starvation. Promise callbacks resolve into the microtask queue, which is also drained before each phase transition — just after the nextTick queue. A recursive chain of resolved promises starves the poll phase for exactly the same reason. This matters because the natural refactor for many engineers — "let me rewrite this as `async/await`" — does not help unless the yield is ultimately backed by `setImmediate`.

The only `await` that correctly yields to I/O is one backed by `setImmediate`: `const yieldToLoop = () => new Promise(r => setImmediate(r))`. This is a common pattern in chunked CPU work and worth having in your toolkit.

---

**The load output shows a burst, not a gradual recovery — and that burst is a diagnostic signature.**

When the nextTick queue finally empties and the server unblocks, every pending response fires at once. The load simulator shows a cluster of `⚠` health check lines arriving together, immediately followed by normal latency. This pattern — a burst of delayed responses, not a gradual slowdown or timeout — is specific to event loop starvation (whether from synchronous blocking or microtask queue flooding). Gradual degradation under concurrency looks different. A senior reading unfamiliar logs would use this burst as a first filter before looking at any code.

---

### 🟢 Bonus

**`process.nextTick` is correct in other contexts — the mistake is its use here, not its existence.**

`process.nextTick` is designed for scheduling a callback after the current synchronous call stack completes but before any I/O fires. The canonical use case: emitting an error or event inside a constructor, so that callers have a chance to attach handlers before the event fires. Using it as a general "yield between chunks" mechanism conflates its actual contract — "fire before I/O" — with "yield to I/O," which are opposites.

---

**A streaming approach sidesteps this class of bug at the design level.**

Expressing the batch as a Node.js `Readable` stream or an `async` generator consumed with `for await...of` ties the processing rate to the consumer's ability to read. The event loop stays involved by design — the pipeline yields naturally between chunks because the stream protocol requires it. For large, chunked CPU work that runs regularly, this is a more robust architecture than manual `setImmediate` scheduling.

---

## Common Mistakes

**Thinking `process.nextTick` and `setImmediate` are interchangeable "yield" mechanisms.** They are not. `nextTick` fires before any I/O; `setImmediate` fires after. The difference is the poll phase. Engineers who know both exist but treat them as stylistic alternatives will write this bug and not understand why the fix works.

**Rewriting the function with `async/await` and expecting it to help.** An `async` function with `await Promise.resolve()` between chunks has the same starvation problem. Promise microtasks drain before the poll phase. The `async` keyword changes syntax, not event loop behavior.

**Diagnosing it as synchronous blocking.** The CPU profile does not show a single long task. A profiler shows many short tasks in rapid succession with no I/O gaps between them. An engineer who only knows "check for long synchronous tasks" may look at the flamechart, see nothing obviously wrong, and conclude the problem is elsewhere.

**Testing the fix by measuring CPU usage or overall job duration.** Both look fine in both the broken and fixed versions. The difference is invisible to metrics that don't specifically track inter-request latency or event loop lag.
