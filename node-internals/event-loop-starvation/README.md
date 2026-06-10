# Event Loop Starvation

> Health checks are failing. The endpoint takes 2ms. The problem is somewhere else entirely.

---

## Scenario

An internal analytics API has been running fine for two weeks. Most endpoints respond in under 10ms. The team recently shipped a dashboard that polls `/reports/summary` every few seconds to show live stats.

Within a day, ops starts seeing intermittent health check alerts. Not every check fails — but `/health`, which should always respond instantly, starts showing response times above 200ms. The alerts correlate with dashboard traffic. The working theory is that the server is "under load."

It isn't. The server is lightly loaded. Something else is happening.

You've been handed the codebase and asked to explain why a health check endpoint is affected by a completely separate report endpoint — and what to do about it.

---

## Your Task

1. **Run the app and the load simulator** (see *How to Run* below). Watch the `[health]` latency values in the load terminal. Get a feel for the baseline, then watch what happens when a report request fires.

2. **Explain the mechanism** — not just "the report is slow" but why a slow report endpoint delays an unrelated health check endpoint. What specifically is happening in the runtime during those 300ms?

3. **Identify what in the code is responsible** for the blocking. There's more than one expensive operation in `generateSummary` — be specific about what's doing the most damage and why.

4. **Propose and evaluate fixes**. There are at least two real options, and they have different tradeoffs. Your analysis should explain both and say which you'd choose.

5. **Write your findings in `my-analysis.md`** before opening `rubric.md` or `solution/`.

A strong answer explains the *mechanism* precisely — the kind of answer you'd give in a post-mortem or a senior interview when someone asks "why did the health check fail?"

---

## Prerequisites

Node.js and Express familiarity. Knowing what async/await does is assumed; knowing *why* it doesn't solve every performance problem is what this exercise is about.

If Node's "non-blocking" model or the event loop phases aren't clear to you, read `tutorial.md` first. If you're already solid on both, jump straight in.

---

## How to Run

**Terminal 1 — start the server:**

```bash
cd app
npm install
node --inspect index.js
```

The `--inspect` flag enables Chrome DevTools profiling if you want to see the long task on the main thread (optional but instructive).

**Terminal 2 — simulate load:**

```bash
node load.js
```

Health checks run every 100ms. A report request fires every 6 seconds, after a 2-second baseline period. Health checks delayed more than 50ms are marked with `⚠`.

**Chrome DevTools (optional):**

```
chrome://inspect → inspect → Performance tab → Record
```

Trigger a report during recording. Look for the long yellow block on the main thread.

---

## How to Self-Evaluate

Once you've written your analysis, open `rubric.md` and compare it against what a senior engineer would have noticed.

To get AI-assisted feedback on your reasoning:

```bash
cd ../../ai-evaluator
node evaluate.js --exercise ../node-internals/event-loop-starvation
```
