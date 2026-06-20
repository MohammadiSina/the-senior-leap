# [Exercise Name]

> [One sentence that sets the scene — write it like an incident alert or a Slack message from your manager, not a tutorial heading. Good: "The queue is at 800k messages and climbing. The campaign goes out in four hours." Not this: "In this exercise, we will explore queue management under load."]

---

## Scenario

<!-- Describe the situation as if it is happening right now. The learner has just been handed
     this problem. Use present tense, specific numbers, specific symptoms, specific conditions.
     Good: "The notification service has handled 50k messages per day without incident for eight
     months. A campaign targeting 4 million users launches in 72 hours. There is no load test
     documentation above 200k. Nobody knows what happens at 4 million."
     Not this: "In this exercise, you will explore scaling challenges in notification systems."
     Embed artifacts inline where contextually relevant — not batched at the end of the section.
     Delete artifact types that do not apply to this exercise. -->

[Scenario prose — written in present tense, from inside the situation]

<!-- ARCHITECTURE DIAGRAM → use a Mermaid fenced code block with graph TD or graph LR syntax.
     Include only the components relevant to the scenario — not the full system.
     See system-design/GUIDE.md → Artifact Handling for a complete example. -->

<!-- TIMELINE → use a labeled ordered list. Include only for incident post-mortems and scenarios
     where the sequence of events is part of the evidence the learner must reason against.
     - **03:14 UTC** — deploy completes; queue depth: 12,000 messages
     - **03:17 UTC** — queue depth: 180,000; worker CPU at 98%
     - **03:22 UTC** — first worker crash; duplicate notifications begin
     - **03:31 UTC** — on-call manually scales workers; queue stabilizes -->

<!-- METRICS → use a markdown table. Include when the numbers are the evidence — the learner
     must reason against data, not just a prose description of what happened.
     | Time (UTC) | Queue Depth | Active Workers | Error Rate | p99 Latency |
     | ---------- | ----------- | -------------- | ---------- | ----------- |
     | 03:00      | 12,000      | 4              | 0.1%       | 180ms       |
     | 03:15      | 45,000      | 4              | 0.8%       | 420ms       |
     | 03:20      | 180,000     | 4              | 14.2%      | 8,400ms     |
-->

<!-- REQUIREMENTS OR CONSTRAINTS → use markdown headers and lists. Write them as real documents —
     product briefs, compliance notices, stakeholder emails. The learner should feel they are
     reading an actual artifact, not an exercise description.
     ### Compliance Notice — Data Retention
     Per the enterprise agreement, all user-generated events must be retained in reconstructable
     form for a minimum of seven years. Point-in-time recovery must be possible for any event
     within that window. -->

---

## Your Task

<!-- Step 1 is always pre-design questions — do not remove or merge it into another step.
     Tailor steps 2–4 to the exercise pattern. See system-design/GUIDE.md → Exercise Patterns.
     End with the reminder to write in my-analysis.md before opening rubric.md. -->

1. Before proposing anything, write down the questions you would ask first. What do you need to know before you can design anything? What assumptions in the current setup are you most uncertain about?
2. [Exercise-specific step]
3. [Exercise-specific step]
4. [Exercise-specific step — consider: what risks remain after your changes, and why are they acceptable?]
5. Write your full reasoning in `my-analysis.md` before opening `rubric.md`.

---

## Prerequisites

<!-- Include only if the exercise requires knowledge that cannot reasonably be assumed.
     Delete this section entirely if no tutorial is needed. -->

If [concept] is new to you, read `tutorial.md` first. Otherwise, jump straight in.

---

## How to Self-Evaluate

Once you have written your analysis, open `rubric.md` and compare it against what you found.

To get AI-assisted feedback on your reasoning — especially useful for the uncertainties you flagged:

```bash
cd ../../ai-evaluator
node evaluate.js --exercise ../system-design/[exercise-name]
```
