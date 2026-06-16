# Rubric — Async Error Propagation

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.

---

## What a Senior Engineer Would Notice

Items are grouped by how much their absence reveals a gap in thinking.

---

### 🔴 Critical

**`sendNotification` is called without `await` — its rejection is unhandled.**

The call `sendNotification(orderId, email)` on the success path returns a promise that nobody observes. When the email service rejects (roughly 10% of the time), the promise rejects with no `.catch()` handler and no `await` to convert it into a caught exception. In Node 15+, this triggers the default `unhandledRejection` behavior: the process exits with code 1.

The code looks intentional — "fire-and-forget, the email doesn't need to block the response." The developer's reasoning was sound for the success case. But they didn't account for failure. An `async` function that can reject must have its rejection handled, even if you don't care about the return value. The fix is either `await sendNotification(...)` inside a `try`/`catch`, or `sendNotification(...).catch(err => ...)`.

If your analysis says "the notification fails" without explaining *why the failure is invisible and crashes the process*, you've identified the symptom but not the mechanism.

---

**`Promise.all` doesn't roll back side effects from already-resolved promises.**

`Promise.all([chargeCard(), updateInventory()])` starts both operations concurrently. `updateInventory` completes in 5–30ms. `chargeCard` takes 100–500ms. When `chargeCard` rejects (payment declined), `Promise.all` rejects immediately — but the inventory decrement already happened. There's no rollback mechanism.

The response correctly returns a 500 error. The order is marked "failed." But the inventory is permanently decremented for an order that was never charged. Over time, this drift accumulates: inventory shows fewer units than the payment records account for.

This is not a theoretical concern. In a real system, this means a customer gets charged nothing but the stock disappears. A senior engineer would recognize that parallelizing operations with side effects requires either (a) ensuring the side effect is idempotent and reversible, (b) executing them sequentially (charge first, then update), or (c) using a saga or transaction pattern.

---

### 🟡 Important

**The error is caught — but only for the `Promise.all` rejection, not for the notification.**

The `try`/`catch` block around the processing pipeline handles the `Promise.all` rejection correctly: it marks the order as "failed" and returns a 500. This is proper error handling for the main flow.

But the `catch` block gives a false sense of security. It looks like all errors are handled. The notification error slips through because it's outside the `await` chain. A senior reviewing this code would notice that the `try`/`catch` covers the `await Promise.all(...)` but not the `sendNotification(...)` call — and ask whether that's intentional.

---

**The process crash is silent because there's no diagnostic handler.**

When the process exits due to an unhandled rejection, the default behavior in Node 15+ is to print a warning and exit. Depending on the environment (container, log aggregation, stdout buffering), this warning may be lost. The process just stops. Ops sees a container restart with exit code 1 and no useful output.

A production service should have `process.on('unhandledRejection', ...)` as a safety net — not to suppress the error, but to log it with full context (request ID, order ID, stack trace) before the process dies. This is the difference between "the process crashed, here's why" and "the process crashed, no idea."

---

### 🟢 Bonus

**Sequential execution is the correct fix for the `Promise.all` issue — not `Promise.allSettled`.**

The instinct to replace `Promise.all` with `Promise.allSettled` is natural but doesn't solve the problem. `Promise.allSettled` waits for all promises to settle and gives you an array of results — but the inventory is already decremented by the time you check the results. You'd need to *undo* the decrement, which requires additional logic.

The simpler and correct fix: execute sequentially. Charge the card first. If it succeeds, update inventory. If it fails, inventory was never touched. This is slower (the operations don't overlap) but correct. For operations with side effects, correctness beats performance.

If the performance cost of sequential execution is genuinely unacceptable (high-throughput payment processing), the next step is a compensation pattern: record the intent, execute both, and if the charge fails, explicitly reverse the inventory change. This is a saga — and it's a different exercise.

---

**The `simulateLatency` function hides the timing dependency.**

Both `chargeCard` (100–500ms) and `updateInventory` (5–30ms) use `simulateLatency`. The latency ranges are what make the bug probabilistic: `updateInventory` almost always finishes before `chargeCard` rejects. If both had the same latency range, the bug would manifest roughly 50% of the time instead of nearly always.

This is worth noticing because in a real system, the timing dependency might be different — a fast payment gateway and a slow database could flip the race. The bug exists regardless of timing; the timing just determines how often you see it.

---

## Common Mistakes

**Fixing only the notification and missing the `Promise.all` issue.** The process crash is dramatic and grabs attention. It's tempting to add `await` to the notification call, declare victory, and stop. But the inventory drift is the more insidious bug — it corrupts data silently and compounds over time.

**Assuming the `try`/`catch` handles everything.** The error handling looks comprehensive. There's a try, a catch, a proper error response. It's easy to read the code and conclude that errors are handled. The notification call is *inside* the try block — but without `await`, the try/catch doesn't apply to it.

**Confusing "fire-and-forget" with "doesn't need error handling."** Fire-and-forget means you don't need the *result*. It doesn't mean you can ignore *failure*. If a fire-and-forget operation can throw, the throw must be caught — even if you just log it and move on.

**Replacing `Promise.all` with `Promise.allSettled` as the fix.** This changes when the code continues (it waits for everything) but doesn't address the side effect problem. The inventory is already decremented. `Promise.allSettled` just gives you a nicer way to see that it happened.
