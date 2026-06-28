# Contributing to The Senior Leap

The best exercises in this repo will come from real experience — a production bug that taught you something unexpected, a system design call you had to defend, a Docker gotcha that wasn't obvious until it was too late. Those are the scenarios that make someone think differently, which is the whole point.

The bar for a good exercise is not *"does this convey information"* but *"does this make someone reason differently."* If the insight can be absorbed by reading a blog post, it belongs in `tutorial.md` as background — not as the exercise itself.

---

## Before You Start

Check open issues and existing exercises to avoid duplicating something already in progress. If you have an idea but aren't sure it fits, open an issue to discuss it before building it out.

**Check for a topic-level `GUIDE.md`.** Some topics include a `GUIDE.md` in their directory that specifies additional standards, exercise patterns, structural decisions, and quality criteria specific to that topic. If one exists for the topic you are contributing to, read it before writing anything — it takes precedence over the general guidance in this file where the two differ.

---

## Using the Template

Every exercise lives in its own folder inside the relevant topic directory. Start by copying `_template/`:

```bash
cp -r _template/ topic-name/your-exercise-name
```

**Some topics include their own `_template/` directory** for files that differ from the root template. If the topic has a `_template/`, use those files instead of their root counterparts. For any file not present in the topic template, fall back to the root `_template/`.

```bash
# Example: system-design has its own _template/
cp system-design/_template/README.md system-design/your-exercise-name/README.md
cp system-design/_template/rubric.md system-design/your-exercise-name/rubric.md
cp _template/my-analysis.md system-design/your-exercise-name/my-analysis.md
```

Folder names should be lowercase, hyphenated, and describe the scenario specifically.

`memory-leak-event-emitter` ✓  
`node-exercise-3` ✗

---

## What Goes in Each File

### `README.md` — The Scenario

This is what the user reads first. It should feel like a real work situation, not a textbook exercise.

**Good:**
> This Express API has been in production for three days. Memory usage climbs steadily until the process crashes. No errors in the logs.

**Not this:**
> In this exercise, we will explore memory leaks in Node.js event emitters.

Include:
- The scenario — realistic, specific, grounded in something that could happen in a real codebase
- The task — what the user should do and what a good output looks like
- How to run the app, if applicable
- A pointer to `tutorial.md` (optional background) and a reminder not to open `rubric.md` before attempting

**The tutorial hint.** When pointing learners to `tutorial.md`, name the concept — not the diagnosis. The hint should tell learners what background they need, not signal what the root cause is.

> ✅ "If distributed locking is new to you, read `tutorial.md` first."

> ❌ "If lock expiry and job duration interactions are new to you, read `tutorial.md` first." — this names the failure mode before the learner has started.

If the tutorial covers more than one relevant concept, point to it generally rather than naming the specific concept that unlocks the diagnosis.

### `tutorial.md` — Background Knowledge

Only what the user needs to attempt the exercise. Not a comprehensive guide — a targeted primer.

A useful test: if the user already knows this concept well, can they skip this file entirely and still do the exercise? If yes, the tutorial is the right length. If skipping it leaves gaps, it needs more.

Some exercises won't need a tutorial at all. Don't force one.

**What a tutorial should not do:** explain the correct answer or signal the root cause. 
Cover the concept and its mechanics — not the specific way this exercise's conditions cause it to fail. The moment you explain the failure, you've done the exercise for the learner.

### `rubric.md` — What a Senior Would Notice

This is the hardest file to write and the most important one. A weak rubric makes the whole exercise weak.

Each item should:
- Be something a mid-level engineer would **genuinely miss** — not trivia, not something immediately obvious
- Explain **why it matters in practice** — not just *"you should check X"* but *"if you miss X, here's what goes wrong under load / in production / during an incident"*
- Be honest about severity — distinguish between what's critical to notice and what's merely good to notice

Aim for three to five items. A rubric with fifteen points buries what actually matters.

**The test for your rubric:** would a solid mid-level engineer, working through this exercise honestly, miss at least half of what you've written? If not, the exercise isn't targeting the right gap.

### `solution/`

For code exercises: the fixed or reference implementation with inline comments that explain not just what changed, but why — the reasoning, not just the diff.

Some conceptual topics replace `solution/` with a Reference Reasoning section inside `rubric.md`.

### `my-analysis.md`

Use the template as-is. Do not modify it. It's designed to align with both the rubric structure and the AI evaluator's output, and consistency across exercises is intentional.

---

## Exercises With Runnable Apps

If your exercise includes an app, it must run cleanly with one or two commands on a standard setup. For single-service scenarios, a plain Node.js script is preferable. For multi-service scenarios, use Docker Compose.

Always test on a clean environment before submitting — not just from your own working directory.

Document setup inside the exercise `README.md`, not in a separate file.

---

## The Quality Checklist

Before opening a PR, run through this honestly:

- [ ] Can a candidate produce a correct answer without reasoning through the specific conditions given in this scenario? If yes, the scenario is not ready.
- [ ] Did you complete the exercise yourself, from scratch, as a user would?
- [ ] Does the rubric surface things a mid-level engineer would genuinely miss?
- [ ] Does the scenario feel like something from a real codebase, not a constructed example?
- [ ] Does the tutorial hint name a concept — not the diagnosis or root cause?
- [ ] If there's a runnable app, does it work on a clean setup with one or two commands?
- [ ] Is the tutorial lean enough that someone who knows the topic can skip it without missing anything for the exercise?
- [ ] Are there three to five focused rubric items rather than an exhaustive list?
- [ ] If the topic has a `GUIDE.md`, does the exercise meet the criteria it defines?

---

## What Doesn't Belong Here

To keep the repo focused, these are out of scope:

- LeetCode-style algorithm challenges
- Frontend-specific exercises
- Deep cloud infrastructure beyond Docker Compose and basic orchestration
- Exercises where the main insight is better delivered as a blog post
- Exercises targeting the junior-to-mid gap rather than mid-to-senior

If you're not sure whether something fits, open an issue first.

---

## Submitting

Open a pull request with your exercise folder. In the PR description, answer:

- What scenario does this exercise present?
- What would a mid-level engineer typically miss here, and why?
- Have you tested it from a clean setup?

Expect feedback on the rubric — it's the part that most often needs iteration, and getting it right is worth the back-and-forth.