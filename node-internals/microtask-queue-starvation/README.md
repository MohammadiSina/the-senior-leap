# Microtask Queue Starvation

> The liveness probe is still killing the service during batch jobs — but the engineer says the event loop fix was already shipped.

---

## Scenario

The report service generates scored summaries from batches of transaction records submitted by internal tooling. A month ago it was crashing under load: a synchronous loop over the full batch was blocking the event loop, and the Kubernetes liveness probe was timing out and restarting the process.

That was fixed. The loop was broken into per-record chunks, with `process.nextTick` used to yield between them. The change was reviewed, merged, and deployed. The engineer who wrote it was confident: the event loop could now breathe between each record.

The liveness probe is still restarting the process during batch jobs. `/health` still fails to respond for the entire duration of a batch. The engineer is confused — the fix is in production, the loop yields on every record, and yet nothing has changed.

Your job is to figure out why the fix doesn't work.

---

## Your Task

1. Read `app/index.js`. Focus on where `process.nextTick` fits in the event loop's execution model — specifically, what it does and does not yield to.

2. Run the app and the load simulator and observe `/health` latency during a batch job. Pay attention to when the delayed responses arrive relative to the job completing.

3. Write your findings and any uncertainties in `my-analysis.md` before opening `rubric.md` or `solution/`.

A strong answer explains not just *what* to change but *why* `process.nextTick` doesn't work here when `setImmediate` would — the kind of explanation you'd give in a post-mortem or a code review.

---

## Prerequisites

This exercise is best attempted after `event-loop-starvation` or with equivalent familiarity with why synchronous code blocks the event loop. The concept at play here is one level deeper: not that blocking is bad, but that there are different kinds of yielding with different starvation properties.

If the event loop's phase model — especially the distinction between the nextTick queue and the check phase — is new to you, read `tutorial.md` first. If you've worked through `event-loop-starvation` and understood its fix, skim the tutorial's *How It Works* section before diving in.

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

Health checks run every 100ms. After a 2-second baseline, a 200-record batch job is submitted. Watch when the delayed health check responses arrive — the timing is as informative as the latency numbers.

---

## How to Self-Evaluate

Once you've written your analysis, open `rubric.md` and compare it against what you found.

To get AI-assisted feedback on your reasoning:

```bash
cd ../../ai-evaluator
node evaluate.js --exercise ../node-internals/microtask-queue-starvation
```
