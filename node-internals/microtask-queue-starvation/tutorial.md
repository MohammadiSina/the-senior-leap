# The Event Loop's Queues and Phase Ordering

> Already know why `process.nextTick` and `setImmediate` schedule callbacks at different points in the event loop — and why that matters for I/O? Skip this and go straight to `README.md`.

---

The `event-loop-starvation` exercise covers why synchronous JavaScript blocks the event loop. This tutorial covers something one level deeper: the event loop has multiple phases with distinct scheduling mechanisms, and "yielding" to one of them is not the same as yielding to all of them.

---

## How It Works

Node's event loop is not a single queue. It is a sequence of **phases**, each of which drains a specific category of callbacks before moving to the next. The phases that matter most here, in order, are:

```
timers          → setTimeout / setInterval callbacks whose time has elapsed
pending cbs     → deferred I/O error callbacks from the previous iteration
poll            → new I/O events: incoming network data, file reads completing
check           → setImmediate callbacks
```

Alongside these phases, Node maintains two additional queues that are handled separately:

- The **nextTick queue** — callbacks scheduled with `process.nextTick`
- The **microtask queue** — resolved Promise callbacks (`.then`, `await`)

These queues are not phases. They are drained **between every phase transition**, and the nextTick queue is always drained before the microtask queue. The event loop does not move from one phase to the next until both queues are completely empty.

This ordering is what makes `process.nextTick` useful for fine-grained sequencing — and what makes it dangerous in a loop.

## The Starvation Mechanism

Suppose you have a recursive function that schedules the next call with `process.nextTick`:

```javascript
function processNext(i) {
  doWork(i);
  process.nextTick(() => processNext(i + 1));
}
processNext(0);
```

Here is what the event loop sees:

1. `processNext(0)` runs. `doWork(0)` runs. `processNext(1)` is added to the nextTick queue.
2. The JavaScript stack unwinds. Node checks the nextTick queue — it is not empty.
3. `processNext(1)` runs. `doWork(1)` runs. `processNext(2)` is added to the nextTick queue.
4. Node checks the nextTick queue — still not empty.
5. Repeat.

The nextTick queue never empties. The event loop never advances to the poll phase. Any incoming HTTP request that arrived at the OS while this was running sits in the kernel's socket buffer, waiting for the poll phase to pull it in. It will wait for the entire duration of the loop.

The code is not "blocking" in the sense of one long synchronous call — V8 is constantly returning control to Node between each `doWork` call. But it is still starving the poll phase, which is where I/O callbacks live.

## What to Watch For

**`setImmediate` is the correct yield point for CPU-chunked work.** `setImmediate` schedules callbacks in the check phase, which comes *after* the poll phase. Replacing `process.nextTick` with `setImmediate` in the example above means the event loop now runs a full iteration between each chunk — including the poll phase, where queued I/O callbacks fire. Health checks get through. Timers fire. New requests are accepted.

**Promises have the same problem.** `await Promise.resolve()` resolves into the microtask queue, not the check phase. A recursive chain of `await new Promise(r => r())` starves I/O just as thoroughly as `process.nextTick`. The fix is always `setImmediate` or a helper like `const yieldToEventLoop = () => new Promise(r => setImmediate(r))`.

**`process.nextTick` is not wrong — it is wrong here.** It exists for specific use cases: scheduling a callback after the current synchronous call completes but before any I/O fires. For example, emitting an error event after an object is constructed gives callers a chance to attach listeners first. The mistake is using it as a general "yield to the event loop" mechanism, which it is not.

---

## Further Reading

- [Node.js docs: The Node.js Event Loop](https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick) — the official guide on phases, `process.nextTick`, and `setImmediate`, including the comparison between them.
- [Node.js docs: `process.nextTick` vs `setImmediate`](https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick#processnexttick-vs-setimmediate) — the specific section addressing why the two are frequently confused.
