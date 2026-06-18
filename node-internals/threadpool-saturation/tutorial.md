# The libuv Thread Pool

> Already know which Node.js APIs use the thread pool, why it's separate from the event loop, and why `UV_THREADPOOL_SIZE` matters? Skip this and go straight to `README.md`.

---

"Node.js is single-threaded" is a useful simplification and also not quite true. The JavaScript you write runs on one thread — the main thread, the one the event loop lives on. But Node itself, underneath your code, maintains a small pool of OS threads for a specific category of work. That pool is provided by **libuv**, the C library that gives Node its event loop and async I/O in the first place.

---

## How It Works

Some operations genuinely cannot be done in a non-blocking way at the OS level — there's no equivalent of epoll/kqueue for them. Reading a file, resolving a hostname the traditional way, and a handful of CPU-heavy crypto routines all fall into this bucket. To keep these off the main thread without blocking anything, libuv hands them to a worker pool: a fixed number of background OS threads that do the actual blocking work, and notify the main thread via the event loop when they're done.

By default, that pool has **4 threads**, regardless of how many CPU cores the machine has. It is shared by every part of the process that needs it. There's only one pool per process — not one per module, not one per route.

**APIs that use the thread pool:**
- All of `fs.*` (the async, callback/promise-based versions — `fs.readFile`, `fs.writeFile`, `fs.stat`, etc.)
- `dns.lookup()` specifically (not `dns.resolve()` — that one uses non-blocking DNS via c-ares and doesn't touch the pool)
- Several `crypto` functions: `pbkdf2`, `scrypt`, `randomBytes` (for larger sizes), and a few others
- Some `zlib` operations

**APIs that do *not* use the thread pool:**
- Network sockets — HTTP requests, database drivers like `pg` or `mysql2`, anything built on TCP. These use the OS's non-blocking I/O multiplexing (epoll on Linux, kqueue on macOS) directly. There's no fixed pool size limiting how many open sockets you can wait on concurrently.
- Timers (`setTimeout`, `setInterval`) — these are scheduled by the event loop itself, not dispatched anywhere.
- Plain JavaScript computation — that's main-thread work, covered by a different exercise (`event-loop-starvation`) entirely.

This split matters: a service can be doing real, finite, contended work on the thread pool while its main thread sits idle and every socket-based operation continues at normal speed. Nothing about that contradicts "Node is non-blocking" — it just means non-blocking doesn't mean infinite capacity.

## `UV_THREADPOOL_SIZE`

The pool size is configurable via the `UV_THREADPOOL_SIZE` environment variable, up to a hard cap (1024 in recent Node versions). It is read once, when libuv initializes the pool — which happens lazily, the first time something actually needs it. In practice this means: set it as an environment variable before the process starts.

```bash
UV_THREADPOOL_SIZE=8 node index.js
```

Setting `process.env.UV_THREADPOOL_SIZE` from inside your own code is fragile — if anything earlier in your require chain has already triggered a thread-pool-using call, the pool is already sized and your assignment does nothing silently.

Raising the number isn't free, either. More threads means more OS-level context-switching and memory overhead. For I/O-wait-bound work (most `fs` calls), a larger pool can genuinely help up to a point. For CPU-bound work running *on* the pool (like `pbkdf2`), more threads than you have physical cores buys you nothing — you're not waiting on I/O, you're waiting on a CPU, and there are only so many of those.

## What to Watch For

- The thread pool is **one shared resource**, not one per API. Heavy use of any two thread-pool APIs (like a CPU-heavy crypto function and a local file read) are not separate concerns — they compete for the same four threads by default, even if they live in completely different modules.
- A saturated thread pool does not show up as high CPU usage in the obvious places. The work is real, but it's spread across at most a handful of background threads — on an 8+ core machine, that can look like "everything's fine" on a top-level CPU graph while the threads doing the work are maxed out.
- There is no equivalent of a database pool's `idleCount` or `waitingCount` for the libuv thread pool. You can't query "how many threads are busy" from plain JavaScript. Diagnosing this in production means correlating response times across routes, or reaching for a tool built for it.
- `Clinic.js`'s `bubbleprof` command is built specifically to visualize async operation queuing, including thread pool wait time — distinct from `clinic doctor`, which is built for CPU-bound main-thread blocking.

---

## Further Reading

- [Node.js docs: Thread Pool](https://nodejs.org/en/docs/guides/dont-block-the-event-loop/#what-can-you-do) — the official guide's section on the thread pool's role and limits.
- [libuv documentation: Thread pool work scheduling](https://docs.libuv.org/en/v1.x/threadpool.html) — the underlying mechanism, from the library that implements it.
- [Clinic.js: Bubbleprof](https://clinicjs.org/bubbleprof/) — the tool for visualizing async/thread pool queuing specifically.
