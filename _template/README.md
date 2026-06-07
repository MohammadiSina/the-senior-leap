# [Exercise Name]

> [One sentence that sets the scene — write it like a Slack message or incident ticket, not a tutorial heading.]

---

## Scenario

<!-- Describe the situation as if it's happening in a real codebase.
     The user should feel like they've just been handed a problem, not enrolled in a course.

     Good: "This API has been in production for three days. Memory climbs steadily until the process crashes. No errors in the logs."
     Not this: "In this exercise, you will learn about memory leaks in Node.js." -->

## Your Task

<!-- What should the user actually do? Be specific about what a good output looks like.
     End with a reminder to write their analysis before looking at anything else. -->

1. [First step]
2. [Second step]
3. Write your findings and any uncertainties in `my-analysis.md` before opening `rubric.md` or `solution/`.

## Prerequisites

<!-- What should the user already know before attempting this?
     If the concept might be unfamiliar, point to tutorial.md. -->

If [concept] is new to you, read `tutorial.md` first. Otherwise, jump straight in.

## How to Run

<!-- Delete this section entirely if there is no runnable app. -->

```bash
cd app
npm install && node index.js
```

For multi-service setups:

```bash
cd app
docker compose up
```

[Add any load simulation or tooling commands if relevant — e.g. running a load script, opening DevTools, etc.]

## How to Self-Evaluate

Once you've written your analysis, open `rubric.md` and compare it against what you found.

To get AI-assisted feedback on your reasoning — especially useful if you had uncertainties:

```bash
cd ../../ai-evaluator
node evaluate.js --exercise ../[topic]/[exercise-name]
```
