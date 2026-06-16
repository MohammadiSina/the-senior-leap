# Async Error Propagation

> Some orders get a 200 response but no confirmation email. Others fail silently — the process exits with code 1 and no stack trace. Finance says inventory doesn't match charges.

---

## Scenario

Your team runs an order processing service. It receives payment webhooks from an external provider, validates the order, charges the card, decrements inventory, and sends a confirmation email. In staging, it's been solid for weeks — the load is low, and external services rarely fail.

In production, three things go wrong within the first day:

1. Some webhook requests return 200 — the order is marked "completed" — but the customer never receives a confirmation email. The email service logs show no attempt was made.
2. Randomly, the process exits with code 1. No unhandled exception in the logs, no stack trace. The container restarts, and it happens again a few hours later.
3. The finance team notices that inventory counts are lower than they should be. More units have been decremented than there are successful charges in the payment records.

The service has been running for less than 24 hours. You've been handed the codebase and asked to explain all three.

---

## Your Task

1. **Run the app and the load simulator** (see *How to Run* below). Watch both terminals. The load simulator reports successful orders, charge failures, and inventory drift. The server terminal may show unexpected output.

2. **Trace the async control flow** for a single webhook request. What happens in order? What runs concurrently? What's fire-and-forget? Draw the timeline.

3. **Explain each of the three failures.** Not just "the notification fails" — why does the process crash? Why is the error invisible? Why does inventory drift happen even when the error response is correct?

4. **Propose fixes.** There are at least two issues in the code, and they have different solutions. Your analysis should explain each fix and any tradeoffs.

5. **Write your findings in `my-analysis.md`** before opening `rubric.md` or `solution/`.

A strong analysis traces the async flow, identifies where each promise rejects, and explains what happens to the rejection at each point — not just what's broken, but *why the error is invisible*.

---

## Prerequisites

If unhandled promise rejections and `Promise.all` failure semantics are new to you, read `tutorial.md` first. If you're already solid on async error behavior, jump straight in.

---

## How to Run

**Terminal 1 — Start the server:**

```bash
cd app
npm install && node index.js
```

**Terminal 2 — Run the load simulator:**

```bash
cd app
node load.js
```

The load simulator creates 50 orders, sends webhooks, and reports results. Watch both terminals — the server may exit unexpectedly, and the load simulator will report inventory drift at the end.

Run the load simulator multiple times to see different outcomes — the bugs are probabilistic (random failure rates), so some runs will crash and others won't.

---

## How to Self-Evaluate

Once you've written your analysis, open `rubric.md` and compare it against what you found.

To get AI-assisted feedback on your reasoning — especially useful if you had uncertainties:

```bash
cd ../../ai-evaluator
node evaluate.js --exercise ../node-internals/async-error-propagation
```
