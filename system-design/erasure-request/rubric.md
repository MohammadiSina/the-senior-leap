# Rubric — Erasure Request

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.
>
> This file also serves as the reference solution — see the Reference Reasoning section at the end.

---

## What a Senior Engineer Would Notice

---

### 🔴 Critical

**Neither canonical escape hatch works for the immediate request, and searching for a third technical option is still the wrong move.**

Crypto-shredding makes data unreadable but not absent — Legal already ruled it out because outside counsel would not commit in writing that it satisfies "erasure" under current ICO guidance. The dual-model approach is correct for new events, but it requires knowing where all PII is in order to extract it; three years of free-text `MessageAdded` events with PII at arbitrary positions in unstructured content cannot be reliably de-identified without destroying the semantic content that makes the events replayable. A learner who proposes either option for the immediate request has not read the constraints. More critically, a learner who searches for a third technical option — event mutation, tombstone events, selective log compaction — is still operating in the wrong domain. Every such option either mutates the log (which breaks replay integrity and breaches Section 4.3) or makes data unreadable without deleting it (which is crypto-shredding by another name, and already ruled out). The senior observation is that there is no clean technical path, and stating this clearly is more valuable to the business than inventing a speculative workaround.

**The enterprise SLA creates a second binding legal obligation in direct conflict with GDPR Article 17, and the resolution belongs to Legal — not to engineering.**

GDPR Article 17 requires that Müller's personal data be erased. Section 4.3 of the Hartmann GmbH contract guarantees that all events are replayable without exception. Erasing the events satisfies GDPR and breaches the SLA. Preserving them satisfies the SLA and breaches GDPR. This is not an architectural tradeoff — it is a conflict between two legal obligations, and engineers do not have the authority to decide which one the company subordinates. If a learner designs an architecture before this question is answered, they have made a legal assumption on the company's behalf. If they assumed GDPR wins and Legal had intended to seek an ICO extension or negotiate with the customer, the work is committed to the wrong path. The pre-design question a senior surfaces in tomorrow's meeting is not "what do we build?" — it is "which obligation has the company decided takes precedence, and is that decision documented?"

---

### 🟡 Important

**The only appropriate engineering work before the legal decision is reconnaissance — scoping the blast radius without foreclosing any option.**

Before Legal makes the call, engineering can produce two things without risk: a complete audit of every event in the store that contains personal data attributable to Müller — the count, the event types, the affected projections, the time range — and a validation that the tooling exists to execute whatever approach is ultimately chosen quickly once the decision is made. This work is not architecture. It is readiness. The distinction matters operationally: a senior who arrives at tomorrow's meeting with this done can tell the room "we are ready to move in 24 hours once you tell us which path to take." A senior who arrives with an architecture proposal has made an assumption about the legal outcome and may have spent the past three days building in the wrong direction. The work that keeps all options open is the correct work.

---

### 🟢 Bonus

**Section 4.3 will produce this conflict again for every future erasure request from any of the twelve enterprise SLA customers, and the fix is a contract amendment, not a schema change.**

The current SLA template contains no GDPR compliance carve-out. This is not a historical accident — the SLA predates GDPR compliance becoming a live concern for the platform. Every future Article 17 request involving a user whose employer holds this SLA creates an identical impasse. The architectural fix (dual-model for new events) handles the event store, but it does not resolve the legal conflict for existing events under existing contracts. Future agreements need a clause that explicitly subordinates replay guarantees to regulatory compliance obligations. A senior names this in the room not because it is their job to draft it, but because no one else in the meeting is likely to be thinking about the forward-looking risk while managing the immediate crisis.

---

## Common Mistakes

- **Proposing crypto-shredding without registering that Day 14 already eliminated it.** This is the most common pattern-match failure. "GDPR plus event sourcing" has a canonical answer, and many learners reach for it without checking whether the scenario permits it. In a real review, proposing a solution that the scenario has already ruled out signals that the engineer is working from a playbook rather than from the specific situation in front of them.

- **Proposing the dual-model approach as a solution to the immediate erasure request.** This approach is correct for new events going forward and a senior should eventually recommend it as future-state architecture. But it does not help with 420 million existing events and a 10-day deadline. A learner who proposes it as the answer to Müller's request has conflated the right long-term direction with an answer to the question actually being asked. The question is what to do in the next 10 days, not how to build the system differently starting today.

- **Designing an architecture before the legal conflict is resolved.** A learner who produces a migration plan, an event mutation strategy, or a schema proposal has assumed that engineering can unilaterally resolve which legal obligation wins. They cannot. Any architecture committed to before that decision is made may need to be entirely unwound — and in a real situation, the pressure to not throw away the work becomes a subtle force toward the wrong decision. The correct move is to force the decision first, then design.

- **Treating the escalation as a failure mode rather than the correct output.** Some learners read this scenario and conclude that they have not solved the exercise because they did not produce an architecture. The scenario is specifically constructed so that no technical architecture is the right answer. The senior skill being tested is recognizing when the problem has left the engineering domain and escalating in a way that forces the business to make the call. Producing a clear, well-framed escalation with the conflict articulated and the options documented is the highest-signal output.

---

## Reference Reasoning

> This is not the correct answer. It is the reasoning a senior engineer would likely apply. A defensible answer that reaches different conclusions through sound reasoning is equally valid.

**Questions a senior asks before designing anything:**

- "Has Legal issued a documented position on which obligation takes precedence — GDPR Article 17 or the enterprise SLA Section 4.3 replay guarantee?" If the answer is no, no architecture should be committed to. The legal outcome determines which technical path is appropriate.
- "What is the company's assessed exposure on each side of this conflict?" The maximum GDPR penalty is 4% of global annual revenue or €20M, whichever is higher. The SLA breach exposes the company to Hartmann GmbH's contract damages. These are not equivalent risks. Legal and the business need to weigh them, and engineering needs to know the answer before selecting an approach.
- "Is the ICO notifiable that the company cannot comply within the statutory 30-day window, and what is the process for that?" If no clean technical path exists, the correct outcome may be notifying the regulator proactively, documenting the good-faith effort, and requesting an extension. This is a legal question, not an engineering question — but a senior names it so Legal knows it is an available path.
- "What is the full scope of Müller's data in the event store?" Engineering cannot advise on options without knowing the blast radius: how many events, which projections they feed, how many read models would be affected by any modification. This question engineering can answer, and should have the answer ready before the meeting.

**What they would likely propose:**

A senior engineer's output for tomorrow's meeting is not an architecture. It is two things: a framing memo that articulates the conflict clearly enough for non-technical stakeholders to make the call, and a readiness report that tells the room what engineering can execute immediately once the decision is made.

The framing memo has three sections: here is what GDPR Article 17 requires, here is what Section 4.3 requires, here is why these cannot both be satisfied. The last section is the most important — it is where a non-technical General Counsel understands why this is in front of them rather than already solved.

If Legal determines that GDPR takes precedence and the SLA must be breached: engineering executes deletion of the affected events, works with Legal to draft the SLA breach notice to Hartmann GmbH, and the legal and commercial teams manage the customer relationship.

If Legal determines that they will seek an ICO extension or notify the regulator of inability to comply: engineering's immediate job is to continue preparation — scope the data, build the tooling — until a compliant path exists.

The forward-state architecture recommendation, independent of the immediate resolution: migrate new events to the dual-model pattern. Pseudonymous identifiers in the event stream, PII in a separately erasable relational store. This satisfies future erasure requests without the current impasse. The historical event store is addressed as a longer-term re-processing effort scoped against actual regulatory risk, not a 10-day emergency.

**What they would explicitly not do, and why:**

- **Implement crypto-shredding for this request** — Outside counsel declined to issue a written opinion that it satisfies erasure under current ICO guidance. Implementing it anyway overrides a legal risk assessment with an engineering preference. The engineer does not have the standing to make that call. If crypto-shredding is later determined to be acceptable by the regulator or through a formal opinion, it can be revisited for future requests.
- **Attempt to retrofit the dual-model pattern to the historical event store under a 10-day deadline** — 420 million events with PII in unstructured free-text cannot be safely re-processed under deadline pressure. A rushed migration of this scope risks data corruption, projection failures, and service instability — which would add an SLA breach from downtime to a list that already includes a potential GDPR violation and a potential contract breach. The risk profile makes it indefensible.
- **Produce an architecture before the legal conflict is resolved** — This is the most important "would not do." Designing a migration plan before Legal has determined which obligation takes precedence creates the appearance of progress while deferring the actual decision. It may also create downstream pressure to commit to the design regardless of the legal outcome, because throwing away engineering work is costly. A senior avoids that trap by refusing to build until the decision is made.

**What risks remain:**

- **The immediate erasure request is very likely unresolvable within the 30-day statutory window through technical means.** The business may need to notify the ICO proactively, document the good-faith effort, and request extended time. This is a known and manageable legal path, but it requires a decision by Legal, not engineering.
- **The enterprise SLA conflict is structural and will recur.** Every future Article 17 request from a user associated with any of the twelve SLA-holding customers creates an identical impasse until contracts are updated. The forward-state architectural fix (dual-model) addresses the event store, but not existing contracts.
- **The historical event store is a managed long-term liability.** Even after the dual-model is in place for new events, three years of historical events contain personal data that is not cleanly erasable under the append-only guarantee. Future erasure requests for users with significant historical activity require the same conflict analysis. This is not solved — it is a known risk the business needs to carry until the historical events age out of retention scope or are re-processed.
