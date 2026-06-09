# Memory Leak — Event Emitter

> The container started at 58 MB. Three days later it's at 340 MB and climbing. No errors in the logs.

---

## Scenario

Your team runs a small internal task API. It's been in production for about a week. Ops flagged it this morning: the container's RSS has been growing steadily since deploy — roughly 80–100 MB per day under normal load. No crashes, no error logs, no obvious cause. A restart brings it back down. Two days later it's climbing again.

You've been handed the codebase and asked to find the leak.

The app is simple: an Express API backed by an in-memory task store. There's audit logging, a handful of routes. Nothing exotic.

---

## Your Task

1. **Run the app and the load simulator** (see *How to Run* below). The server logs its memory every 15 seconds — watch it climb.

2. **Take a heap snapshot baseline** with Chrome DevTools before the leak has had time to grow. Let the load simulator run for 2–3 minutes, then take a second snapshot. Compare them.

3. **Find the root cause** — not just "there's a leak" but: what specific thing is being retained, why it can't be collected, and what should have cleaned it up.

4. **Propose a fix**. There's more than one way to correct this. Your analysis should explain which fix you'd apply and why — and whether any of the approaches have tradeoffs.

5. **Write your findings in `my-analysis.md`** before opening `rubric.md` or `solution/`. The rubric is most useful as a mirror after you've committed to your own analysis.

A strong analysis explains the *mechanism* of the leak, not just the location. "Line 24 is wrong" is a starting point. "Line 24 is wrong because X keeps a reference to Y, which prevents Z from being collected, and at the scale we're running this means W" is a senior-level answer.

---

## Prerequisites

You should be comfortable with Node.js, Express, and how JavaScript closures capture variables. A basic sense of how garbage collection works helps.

If the V8 heap and heap snapshots are new to you, read `tutorial.md` first. If you've used Chrome DevTools memory profiling before, skip it.

---

## How to Run

**Terminal 1 — start the server with the inspector:**

```bash
cd app
npm install
node --inspect index.js
```

The `--inspect` flag starts the V8 inspector, which Chrome DevTools can connect to for heap snapshots. The server logs memory every 15 seconds.

**Terminal 2 — simulate load:**

```bash
node load.js
```

This sends a steady stream of traffic to the server. Watch the memory figures in Terminal 1 — they should start climbing within the first minute.

**Chrome DevTools (for heap snapshots):**

```
chrome://inspect → inspect → Memory tab → Heap snapshot
```

Take a baseline snapshot before load, let the simulator run for 2–3 minutes, take a second snapshot, switch to **Comparison** view, sort by **# Delta**.

---

## How to Self-Evaluate

Once you've written your analysis, open `rubric.md` and compare it against what a senior engineer would have noticed.

To get AI-assisted feedback on your reasoning — especially useful if you had open questions or weren't confident in your diagnosis:

```bash
cd ../../ai-evaluator
node evaluate.js --exercise ../node-internals/memory-leak-event-emitter
```
