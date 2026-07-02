# Rubric — Data Residency Retrofit

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.
>
> This file also serves as the reference solution — see the Reference Reasoning section at the end.

---

## What a Senior Engineer Would Notice

---

### 🔴 Critical

**Before committing to a plan, a senior pins down exactly what "data residency" covers — and notices the Service Readiness table already rules out a full migration in six weeks.**
The contract says this tenant's Jira and Confluence content must live only in the EU realm. That sentence has at least three possible scopes: primary UGC only (Issues, Pages), UGC plus derived/replicated copies (attachments, search indexes), or literally everything that ever touches the tenant's data (identity, routing metadata, backups). The real product deliberately scopes residency to primary UGC at rest — but that's a decision, not a given, and if Legal believes the promise covers more than engineering can deliver, the gap surfaces at audit time instead of now. Worse: the Service Readiness table shows Issue Service — the single most central piece of Jira UGC — isn't deployed to the EU realm at all yet. A learner who doesn't stop on that line and instead writes a migration plan for "the tenant" as if every service is ready has produced a plan for a system that doesn't exist. The six-week deadline cannot be met in full regardless of how well the migration itself is designed, and that has to be said to Legal before any code is written, not discovered in week five.

**The migration must be built as copy-then-verify-then-delete, never delete-before-copy — a plan that treats "move" as one atomic swap will produce silent data loss on any partial failure.**
Under live traffic, a tenant's Issue and Page data has to be duplicated into the EU realm, confirmed complete and correct, and only then removed from `us-east-1` — not written to the new region and immediately cleared from the old one as a single step. The asymmetry matters: if the "add" step fails partway through, the tenant is still fully intact in its original location and nothing is lost — you just retry. If "remove" ran before "add" was verified complete, or the two are coupled into one operation, a failure partway through leaves the tenant with data in neither place, in a live production system, for however long it takes someone to notice. At tenant scale — a single large tenant can hold millions of records — that isn't a rollback, it's an incident with no clean recovery path.

---

### 🟡 Important

**A request or event already in flight when the migration lands needs to be re-checked against the tenant's *current* realm at the moment it's actually processed — not trusted based on where it was when it was sent.**
Anything asynchronous — a queued webhook, a background job, a delayed retry — can be created before the cutover and processed after it. If the consuming service blindly acts on the region it was told to use at submission time, it will read from or write to the tenant's old location after the tenant has already moved, silently reintroducing the exact residency violation the migration was meant to close. A migration plan that only accounts for synchronous request routing and doesn't address anything already queued has a hole that won't show up in testing — only in production, under real timing.

**The plan has to name, explicitly, which parts of the architecture sit outside the realm boundary by design — not let "residency achieved" imply more than the system actually guarantees.**
Identity Platform is global and centralized on purpose — fast login and SSO depend on it not being sharded per realm. Media Service currently replicates a tenant's attachments to all six regions regardless of realm assignment, meaning "the tenant is residency-compliant" can be true for Issues and Pages while attachments are still sitting outside the EU. A senior writes this down as a stated, disclosed scope decision that Legal signs off on — not a gap that gets discovered by the customer's own auditor after the contract is already in force.

---

### 🟢 Bonus

**Not every service needs to replicate to every region just because it can.**
Media Service's current global-replication pattern was a reasonable choice when the only goal was latency across a handful of regions — replicating a tenant's attachments to six regions is cheap enough not to think about. It stops being free as the region count grows, and it's actively counterproductive once a tenant has a residency requirement: replicating outside the realm isn't just wasted cost, it's the thing you're trying to stop doing. Flagging that Media Service's shard assignment for this tenant needs to change too — not just Issue Service's — signals noticing a second-order consequence nobody explicitly asked about.

---

## Common Mistakes

- Treating "migrate the tenant to the EU" as a single well-defined action, rather than a per-service operation that different services are capable of at different times. This produces a plan that looks complete on a slide and is blocked the moment someone tries to execute it against Issue Service.
- Reading the six-week deadline as purely an engineering scheduling problem to solve with better execution, rather than also a scope/expectations problem that needs a conversation with Legal and Sales before the plan is finalized.
- Solving the migration ordering (copy vs. delete) correctly for the primary datastore, but not asking the same "what could be in flight" question about queues, webhooks, and background jobs — the ordering insight doesn't automatically transfer to asynchronous systems unless it's applied deliberately.
- Assuming Identity Platform being global is a bug to fix under this deadline, rather than a scoped, load-bearing design decision that needs to be disclosed rather than re-architected under time pressure.

---

## Reference Reasoning

> This is not the correct answer. It is the reasoning a senior engineer would likely apply and the design they would land on. A defensible answer that reaches different conclusions through sound reasoning is equally valid.

**Questions a senior asks before designing anything:**

- What does the signed contract actually say "data residency" covers — and does that match what the product itself defines residency to mean (primary UGC at rest)? If there's a mismatch, that's a Legal conversation, not an engineering one.
- Of the services that touch this tenant's data, which are capable of hosting EU-realm data *today*, and which aren't? What's the real timeline for the ones that aren't?
- Is the six-week number a hard regulatory deadline, or a negotiated commercial one? Those have very different amounts of flex, and the answer changes what's worth escalating versus what's worth just doing.
- What does "done" mean well enough that Legal can sign off on it — primary datastore only, or does that certification need to include attachments, backups, and anything else that's ever touched the tenant's data?

**What they would likely propose:**

Migrate what's actually ready — Page Service — using a strict copy-verify-delete sequence: write Confluence Pages into the EU realm, verify record counts and integrity against the source, only then remove the `us-east-1` copy, and keep the tenant fully served from the old region at every point where verification hasn't completed. In parallel, treat Issue Service's EU-realm gap as a blocking dependency to escalate immediately, not something to work around — the honest status to give Legal is "partial residency now, full residency on Issue Service's actual regional rollout timeline," not a fabricated six-week promise. Reassign Media Service's shard for this tenant to an EU-only shard as part of the same effort, since it's mechanically similar to the Page Service work and directly closes the "replicating outside the realm" gap. For anything moving through async delivery (webhooks, background jobs), add a check at processing time — not just at submission time — that revalidates the tenant's current realm before acting, and either reroute or safely discard anything that's now stale. Document Identity Platform's global scope explicitly as an accepted, disclosed exception in whatever compliance attestation goes to the customer.

**What they would explicitly not do, and why:**

- Force Issue Service into the EU realm ahead of its normal regional rollout as a one-off exception for this deadline — wrong here specifically because Issue Service holds the tenant's most central data at the largest volume; rushing a regional deployment of the platform's most heavily used service under external deadline pressure risks a much larger blast radius than admitting the deadline can only be partially met.
- Re-architect Identity Platform to be realm-pinned as part of this project — wrong for this scenario because it's a shared, foundational service touching every tenant on the platform, and a rushed regional split under a six-week compliance deadline for one customer is exactly the kind of change that turns a contained, known scope gap into a platform-wide outage risk.
- Promise the customer "fully compliant in six weeks" to protect the deal — wrong because it's a claim the architecture can't back up on that timeline, and the failure mode isn't a missed sprint, it's a compliance attestation that turns out to be false the first time anyone checks.

**What risks remain:**

- Identity Platform stays global by design; a sufficiently strict reading of the contract's residency clause could still treat account/session metadata as in scope, which is a disclosed, negotiated risk rather than a solved one.
- Until Issue Service's own regional rollout catches up, this tenant's residency is partial — Pages and reassigned attachments comply, Issues do not. That gap is acceptable only because it's disclosed and time-bound, not because it's small.
- The copy-verify-delete migration reduces but doesn't eliminate risk during the verification window itself — for the period between "copy written" and "copy verified," the tenant is briefly being served from a location that hasn't yet been confirmed authoritative, and the plan needs an explicit decision about what happens if verification fails partway through a live cutover.
