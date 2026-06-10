# Node.js: The Single Thread and Synchronous Blocking

> Already clear on why CPU-bound work blocks HTTP requests in Node.js? Skip this and go straight to `README.md`.

---

Node.js is famous for being "non-blocking" and handling thousands of concurrent connections. But that reputation comes with a massive caveat that catches many mid-level engineers off guard.

---

## The Coffee Shop Analogy

Imagine a coffee shop with a single cashier (the **Main Thread**) and a kitchen staff (the **OS / libuv thread pool**).

When you order a latte, the cashier takes your order and hands the ticket to the kitchen. While the kitchen makes the latte, the cashier immediately takes the next customer's order. This is how Node handles **I/O** (network requests, database queries, file reads). It's highly efficient.

But what if a customer asks the cashier to manually grind coffee beans with a hand-crank for three minutes? 

The cashier is now physically occupied. They cannot take the next order. They cannot answer a quick question from someone at the front of the line. The entire line stops moving until the grinding is done.

This is **CPU-bound work**.

## I/O vs. CPU in Node.js

"Node is non-blocking" is only half true.

**I/O Operations (Non-Blocking):**
Network requests, file system reads, and database queries are handed off to the operating system or libuv's background threads. The main thread is freed up to handle other incoming HTTP requests.

**JavaScript Execution (Blocking):**
Sorting a massive array, parsing a giant JSON payload, cryptography, or complex math. This is V8 executing JavaScript. It *always* runs on the main thread. There is no kitchen staff for JavaScript execution.

If a route handler executes a synchronous JavaScript function that takes 300ms to complete, the event loop is frozen for 300ms. Incoming requests pile up in the kernel's socket buffer. Even a lightweight `/health` endpoint will time out because the main thread is too busy to send the response.

## The `async`/`await` Trap

A common misconception is that wrapping a heavy function in an `async` function or a `Promise` makes it non-blocking.

`async` and `await` are just syntax for handling *I/O waits*. They tell the event loop: "Pause this function and go do something else *until this I/O operation finishes*."

If your function doesn't do any I/O—if it's just crunching numbers or sorting arrays—there is nothing to `await`. An `async` function that sorts 300,000 items still sorts them synchronously on the main thread, blocking the server the entire time.

## Spotting the Block

You can't fix what you can't see. When an event loop is starved by CPU work, you'll notice:
1. **P99 latency spikes across *all* routes**, not just the slow one.
2. **Chrome DevTools:** If you run your app with `node --inspect index.js`, the Performance tab will show a massive yellow "Long Task" block on the Main Thread.
3. **Clinic.js:** Tools like `clinic doctor` are specifically built to detect event loop starvation and point directly to the synchronous functions causing it.

---

## Further Reading

- [Node.js guide: Don't Block the Event Loop](https://nodejs.org/en/docs/guides/dont-block-the-event-loop) — The official, concise guide on CPU vs I/O.
- [Clinic.js](https://clinicjs.org) — The standard tool for profiling Node.js event loop issues.