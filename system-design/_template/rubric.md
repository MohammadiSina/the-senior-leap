# Rubric — [Exercise Name]

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.
>
> This file also serves as the reference solution — see the Reference Reasoning section at the end.

---

## What a Senior Engineer Would Notice

<!-- QUALITY STANDARD FOR EVERY RUBRIC ITEM
     Each item must be a specific, observable statement — not a topic category.

     ❌ "A senior thinks about caching."
     ❌ "A senior considers idempotency."
     ❌ "A senior would notice the retry behavior."

     These are category names. They tell the learner what to think about, not what to see.
     A learner who reads these cannot tell whether they noticed the right thing.

     ✅ "The worker's retry logic has no idempotency key. If a worker crashes mid-batch,
     it restarts from the beginning of the current batch — not the last successfully sent
     message. Any crash produces duplicates for the entire in-flight batch. At 4M sends
     this means tens of thousands of duplicate notifications from a single worker restart."

     ✅ "Before estimating queue throughput, a senior asks whether the downstream email
     provider has a send rate limit. At 4M messages with a 100 sends/second API cap, the
     minimum delivery window is 11 hours regardless of internal queue performance. No
     architectural change fixes this. Skipping this question makes every throughput
     estimate in the analysis meaningless."

     Every item must also answer: what breaks, degrades, or fails when this is missed?
     Not just that something is wrong — the operational consequence at realistic scale.

     Aim for 3–5 items total across all tiers.
     A rubric with more than five items buries what actually matters. -->

---

### 🔴 Critical

<!-- 2–3 items. Things a senior flags immediately.
     Missing these in a real review or interview signals a fundamental gap —
     not an oversight, but an absent mental model.

     At least one item in this section should surface a question the learner
     should have asked before proposing any design. Pre-design questions are the
     most reliable signal of senior thinking. If the learner jumped straight to
     a solution, this is where that shows up. -->

**[Observation — a complete, specific statement of what is wrong or missing]**
[Operational consequence — what breaks or fails, under what specific conditions, at what scale]

---

### 🟡 Important

<!-- 1–2 items. Things that separate a solid mid-level engineer from a senior.
     Often: operational concerns, second-order failure modes, or observations that
     only surface with production experience.
     These are significant but less likely to cause immediate production failure
     compared to Critical items. -->

**[Observation]**
[Operational consequence]

---

### 🟢 Bonus

<!-- 1 item maximum. A proactive observation a senior might raise unprompted —
     an edge case nobody asked about, a forward-looking question, an operational
     risk that is not the learner's responsibility to solve but worth naming.
     Missing this does not reveal a gap. Noticing it signals senior-level thinking. -->

**[Observation]**
[Why it matters and what it signals about the engineer's thinking]

---

## Common Mistakes

<!-- What do most learners get wrong or skip when attempting this exercise?
     The goal is not "here is the right answer" but "here is why the wrong path
     feels right, and how to recognize when you are on it."
     This section distinguishes a rubric from a solutions manual. -->

- [Mistake — and the specific reason it is a natural but wrong place to go]
- [Another mistake if relevant]

---

## Reference Reasoning

> This is not the correct answer. It is the reasoning a senior engineer would likely
> apply and the design they would land on. A defensible answer that reaches different
> conclusions through sound reasoning is equally valid.

<!-- This section replaces the solution/ directory.
     Do not write a prescriptive specification. Write the reasoning — why each choice
     follows from the constraints given, what was explicitly ruled out and why,
     and what is still unresolved. A senior who cannot name remaining risks has not
     finished thinking.

     The "What they would not do" section often contains the most learning.
     The wrong paths, explained specifically, are more useful than the right path stated plainly. -->

**Questions a senior asks before designing anything:**

<!-- These are not optional questions — they are the constraints that make the design
     deterministic. If a question goes unasked, any answer that follows is built on
     an assumption. Name the questions that most learners skipped. -->

- [Question that reveals the dominant constraint]
- [Question that exposes a hidden dependency or external limit]
- [Question that clarifies what "done" actually means for this scenario]

**What they would likely propose:**

<!-- The design, with rationale. Not a list of technologies — the reasoning that connects
     the constraints to the choices. Write this as a senior engineer explaining their
     thinking out loud, not as a specification document. -->

[Reference design and rationale — specific choices, specific reasons]

**What they would explicitly not do, and why:**

<!-- Name the over-engineered or wrong-direction choices, and explain exactly why they are
     wrong for this specific scenario — not wrong in general. "Kafka is overkill here
     because the write volume is 4M messages once per campaign, not continuous throughput,
     and the operational burden outweighs the benefit at this team's size" is useful.
     "Kafka is not always the right choice" is not. -->

- [Choice] — [why it is wrong for this specific scenario, not wrong in general]
- [Choice] — [same]

**What risks remain:**

<!-- What the proposed design does not solve, and why those risks are acceptable given
     the constraints. Be specific — "this approach has eventual consistency during the
     migration window, which means users may see stale data for up to X seconds" is
     useful. "There are still some risks" is not. -->

- [Risk] — [why it is acceptable or not worth solving now, given the specific constraints]
