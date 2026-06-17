# Connection Pool Exhaustion

> The API handles every test you throw at it. Staging was clean. In production, requests hang — not error, hang — and the database is fine.

---

## Scenario

Your team shipped an order API backed by PostgreSQL. Unit tests pass. Staging looked solid under light traffic. Production went live on Monday.

By Wednesday, ops starts seeing timeouts. Not errors — the requests simply never complete. Client-side timeout fires after 30 seconds. The clients retry, making it worse.

The first instinct is "the database is overloaded." It isn't. The database's own metrics show low CPU, low I/O, no slow queries. The database is fine. Something else is happening.

You've been handed the codebase and asked to explain why requests hang when the database is healthy — and fix it.

---

## Your Task

1. **Run the app and the load simulator** (see *How to Run* below). The load simulator runs in four phases: baseline, order traffic, profile traffic, and combined. Watch the terminal output. Notice when health checks start slowing down — and when they don't.

2. **Identify the root cause(s)** The database metrics are healthy, so the bottleneck is inside the application's connection management. Identify the mechanism causing the pool to drain and propose a fix.

3. **Explain the differential diagnosis.** How would you tell this apart from other causes of "everything is slow"? What would you check first, and why?

4. **Propose fixes.** Each bug has a specific fix. Your analysis should explain both.

5. **Write your findings in `my-analysis.md`** before opening `rubric.md` or `solution/`.

A strong analysis distinguishes the two bugs from each other, explains why each one drains the pool, and names the fix for each. An exceptional analysis also explains how you'd catch this in production before it becomes an incident.

---

## Prerequisites

Express and async/await familiarity. If connection pools or `pg.Pool` are new to you, read `tutorial.md` first. If you've worked with database connection pools before, jump straight in.

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

| Phase | Time     | Traffic                              | What to watch for                          |
| ----- | -------- | ------------------------------------ | ------------------------------------------ |
| 1     | 0–5s     | Health checks only                   | Baseline latency — everything is fast      |
| 2     | 5–25s    | Order requests every 100ms           | Watch the pool stats and health checks     |
| 3     | 25–45s   | Profile bursts (20 concurrent)       | Same — watch what changes                  |
| 4     | 45–60s   | Both combined                        | How do health checks hold up?              |

The simulator prints `.` for fast health checks and `[pool]` stats every 5 seconds. Pay attention to which endpoints slow down and which don't.

**`/pool-stats` endpoint:**

While the app is running, open `http://localhost:3000/pool-stats` in a browser or curl it to see real-time pool state: `total`, `idle`, `waiting`, and `timeouts`.

---

## How to Self-Evaluate

Once you've written your analysis, open `rubric.md` and compare it against what a senior engineer would have noticed.

To get AI-assisted feedback on your reasoning — especially useful if you had uncertainties:

```bash
cd ../../ai-evaluator
node evaluate.js --exercise ../node-internals/connection-pool-exhaustion
```
