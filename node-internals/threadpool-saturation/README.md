# Thread Pool Saturation

> Login is slow. So is loading profile photos. CPU usage looks normal. The database was never involved.

---

## Scenario

Your team runs a small SaaS app: an auth service that hashes passwords on login, and a profile feature that serves avatar images from local disk. Both have been solid in staging for weeks — light traffic, nothing to notice.

At 2am, a credential-stuffing bot starts hammering `/login` with a wave of bad password guesses. The rate limiter on the auth layer hasn't been tuned yet, so the requests get through to the hashing logic before being rejected. By the time someone's paged, support tickets are already coming in — but they're not about login. They're about profile photos not loading. "The app feels frozen, but only on some pages."

On-call checks the obvious things first. CPU usage across all cores: 15–20%, unremarkable. The database dashboard: green, low latency, no slow queries — and besides, avatar images aren't even stored in the database. The health check has been passing the entire time, every few seconds, instantly. Nothing in the logs says "error." Two completely unrelated features — password hashing and serving a static file — are degrading together, and nothing about the obvious metrics explains why.

You've been handed the codebase and asked to explain it.

---

## Your Task

1. **Run the app and the load simulator** (see *How to Run* below). The load simulator runs in four phases — watch which routes slow down, when, and which never do.

2. **Identify the shared resource.** `/login` and `/avatar/:id` share no code, no module, no obvious dependency. Find the mechanism that couples them anyway.

3. **Explain why `/health` and `/weather` are unaffected.** This is the differential diagnosis. If your explanation doesn't account for why *these two* stay fast while the others don't, it's incomplete.

4. **Propose fixes, and say which one you'd actually ship.** There's a quick mitigation and a real architectural fix — they are not the same thing, and a senior treats them differently.

5. **Write your findings in `my-analysis.md`** before opening `rubric.md` or `solution/`.

A strong analysis names the exact Node.js APIs responsible, explains why they're coupled despite looking unrelated, and explains the absence of a slowdown (in `/health` and `/weather`) as precisely as the presence of one (in `/login` and `/avatar/:id`).

---

## Prerequisites

Comfortable with Express, async/await, and Node's callback-style APIs. If "the libuv thread pool" doesn't mean anything concrete to you yet, read `tutorial.md` first — this exercise assumes you know which Node APIs use it and which don't. If you've already worked through `event-loop-starvation`, you've seen the thread pool mentioned in passing; this exercise is about what happens when you actually exhaust it.

---

## How to Run

**Terminal 1 — start the server:**

```bash
cd app
npm install
node index.js
```

**Terminal 2 — simulate load:**

```bash
node load.js
```

The load simulator runs for 60 seconds in four phases:

| Phase | Time   | Traffic                                | What to watch for                                    |
| ----- | ------ | -------------------------------------- | ---------------------------------------------------- |
| 1     | 0–5s   | Health + weather checks only           | Baseline latency — everything is fast                |
| 2     | 5–25s  | Login traffic (password hashing)       | Watch login latency climb on its own                 |
| 3     | 25–45s | Avatar traffic joins (login continues) | Avatar reads start queueing too — they didn't change |
| 4     | 45–60s | Both combined, full intensity          | Health and weather: still fine. Why?                 |

There's no `/pool-stats`-style endpoint here — unlike a database connection pool, libuv's thread pool exposes no built-in introspection from JavaScript. `GET /debug/inflight` gives a rough, app-tracked count of in-flight calls (not a real measurement of OS thread occupancy), and the server logs flag any individual call that took longer than expected. That's closer to what you'd actually have available during a real incident.

---

## How to Self-Evaluate

Once you've written your analysis, open `rubric.md` and compare it against what a senior engineer would have noticed.

To get AI-assisted feedback on your reasoning:

```bash
cd ../../ai-evaluator
node evaluate.js --exercise ../node-internals/threadpool-saturation
```
