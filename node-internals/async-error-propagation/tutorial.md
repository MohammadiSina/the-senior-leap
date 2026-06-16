# Promises, Rejections, and Async Error Handling

> Already comfortable with how Promise rejection propagates, what Node.js does with unhandled rejections across versions, and why `Promise.all` starts all operations the moment you call it? Skip this and go straight to `README.md`.

---

## How Rejection Propagates

An `async` function returns a Promise. When that function throws — either because of a synchronous `throw` or because it `await`s a rejected Promise — the Promise it returns rejects with that error.

Rejections propagate through `await` chains:

```javascript
async function step1() {
  throw new Error('oops');
}

async function step2() {
  await step1(); // step2 also rejects
}

async function step3() {
  await step2(); // step3 also rejects
}
```

For the rejection to be *handled*, somewhere in the chain there must be either:

- a `.catch()` handler, or
- a `try/catch` around an `await`.

```javascript
try {
  await someAsyncOperation();
} catch (err) {
  console.error(err);
}
```

If nothing handles the rejection, it becomes **unhandled**.

---

## What Node.js Does with Unhandled Rejections

What happens next depends on your Node.js version:

- **Node 14 and earlier:** Prints `UnhandledPromiseRejectionWarning` to stderr but keeps running. This was widely considered a mistake because silent failures in production are often worse than crashes.
- **Node 15 and later:** Treats unhandled rejections as uncaught exceptions. The process exits with code `1`.

Since Node 18 is LTS (and Node 20/22 have followed the same behavior), all current production runtimes crash on unhandled rejections by default.

If your process exits with code `1` and you don't see a useful application-level stack trace, an unhandled rejection is a likely cause.

You can observe them explicitly:

```javascript
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection:', reason);
});
```

This is a **safety net for observability**, not a fix. The underlying error still happened and your program still failed to handle it correctly.

The correct fix is to either:

- `await` the Promise, or
- attach a `.catch()` handler.

---

## The Fire-and-Forget Trap

Calling an `async` function without `await` discards its returned Promise:

```javascript
async function handler(req, res) {
  res.json({ ok: true });
  doSomeWork(); // returns a Promise; that Promise is discarded
}
```

If `doSomeWork` rejects, nothing is watching that rejection. The rejection becomes unhandled.

This pattern is known as **fire-and-forget**.
It's intentional when you genuinely don't care whether the work succeeds. In almost every other case, it's a bug.
The pattern often appears when developers want to respond quickly and do work afterward:

```javascript
res.json({ received: true });
processOrder(order); // "runs in the background"
```

The intent is reasonable.
The implementation is not.

Sending the response first and *then* awaiting is perfectly valid:

```javascript
res.json({ received: true });

try {
  await processOrder(order);
} catch (err) {
  console.error('Processing failed:', err.message);
}
```

The response has already been sent.

`await` doesn't block Node.js or prevent it from serving other requests. It suspends the current function, yields back to the event loop, and allows other work to continue. The difference is that errors from `processOrder` are now catchable.

---

## Promise.all and Eager Execution

Promises in JavaScript are **eager**: execution starts when the Promise is created, not when you `await` it.

```javascript
const p1 = doSomething();     // starts immediately
const p2 = doSomethingElse(); // also starts immediately

await Promise.all([p1, p2]);
```

`Promise.all` doesn't launch operations.

It simply waits for Promises that are already running.

`Promise.all()` returns a Promise that:

- **Fulfills** when all input Promises fulfill.
- **Rejects** as soon as any input Promise rejects.

This is known as **fail-fast** behavior.

Consider this example:

```javascript
await Promise.all([
  chargeCard(order),       // rejects at t=300ms
  updateInventory(order),  // completes at t=20ms
]);
```

Timeline:

- `t=0ms`: Both operations start.
- `t=20ms`: Inventory is decremented.
- `t=300ms`: Payment fails.
- `Promise.all` rejects.

The important detail is that `updateInventory` never stopped running.

Its side effect already happened.

This can lead to data inconsistencies because the overall operation failed while some changes were still committed.

When operations have a causal dependency — the second should only happen if the first succeeded — they should be sequenced:

```javascript
await chargeCard(order);

await updateInventory(order);
```

The tradeoff is latency:

- Sequential execution takes roughly `sum(durations)`.
- Parallel execution takes roughly `max(durations)`.

If correctness depends on ordering, the extra latency is the right tradeoff.

---

## Promise.allSettled — The Alternative

Sometimes you genuinely want every operation to finish, regardless of whether some fail.

`Promise.allSettled()` waits for all Promises to settle and never short-circuits.

```javascript
const results = await Promise.allSettled([
  chargeCard(order),
  updateInventory(order),
]);
```

Example result:

```javascript
[
  { status: 'fulfilled', value: ... },
  { status: 'rejected', reason: ... },
]
```

This lets you inspect each outcome individually:

```javascript
for (const result of results) {
  if (result.status === 'rejected') {
    console.error(result.reason);
  }
}
```

Use `Promise.allSettled` when:

- every task should get a chance to complete,
- you need a full picture of successes and failures, or
- partial failure is expected and manageable.

The tradeoff is that you lose fail-fast behavior and always wait for everything to finish.

---

## Spotting the Problem

When investigating async error issues, look for these patterns:

1. **`async` functions called without `await`**
   - Especially in route handlers and event listeners.

2. **`Promise.all` used with side effects**
   - Database writes, inventory updates, external API mutations, cache invalidations, etc.

3. **Processes exiting with code `1`**
   - Particularly without obvious application-level logging.

These three clues account for a surprising number of production async bugs.

---

## Further Reading

- [Node.js docs: `process` — `unhandledRejection` event](https://nodejs.org/api/process.html#event-unhandledrejection)
- [MDN: Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all)
- [MDN: Promise.allSettled()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled)