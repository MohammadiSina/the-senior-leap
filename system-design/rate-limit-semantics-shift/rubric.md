# Rubric — Rate Limit Semantics Shift

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.
>
> This file also serves as the reference solution — see the Reference Reasoning section at the end.

---

## What a Senior Engineer Would Notice

---

### 🔴 Critical

**The manager proposed a solution, not a requirement. Before writing a line of code, ask what Meridian's pipeline is actually doing — and whether the proposed fix solves it.**

Meridian's ticket describes six reconciliation jobs running in parallel, each generating 150–250 API calls. Their combined call volume near a minute boundary collectively approaches or exceeds 1,000 — not because any single job is misbehaving, but because their SDK dispatches all API calls as fast as possible with no awareness of the shared rate limit. This is a client-side concurrency problem. The jobs have no coordination mechanism: each starts, fires its calls immediately, and the six streams compete for the same 1,000-request window.

A sliding window enforcer makes this problem slightly smoother — boundary artifacts disappear — but it does not fix the root cause. Six jobs firing flat-out still exceed 1,000 requests per minute in aggregate. Meridian will continue hitting 429s under load; the trigger will just be less predictable.

A client-side request queue — dispatching API calls through a shared rate-aware pool across all concurrent jobs — eliminates the problem without touching the server. The fix is in Meridian's integration, not in the API's enforcement algorithm.

A senior asks this before agreeing to a migration timeline: "What happens to Meridian's pipeline if we ship sliding window and nothing else?" If the answer is "they still hit the limit under load," then the proposed solution does not solve the stated problem, regardless of how many thumbs-up it has.

---

**Before committing to any schema change, audit what existing customers are actually doing at window boundaries.**

Fixed-window semantics permit a client to fire 1,000 requests in the final seconds of minute N and 1,000 more in the opening seconds of minute N+1. Both batches are within quota. In a short span straddling the boundary, the client has effectively sent 2,000 requests without triggering a rejection. This is not a loophole — it is the documented behavior of fixed-window enforcement. Some customers may have deliberately built around it. Others may rely on it as an unintentional consequence of their retry or batching logic without knowing it.

Of the 847 active API keys, some will have request patterns that the boundary allows today and sliding window would reject. The only way to know before shipping is to pull 30 days of access logs and check the distribution of per-key request counts in 120-second windows that cross minute boundaries. Any key whose burst patterns cluster near the boundary — particularly keys with high volume in the final 10 seconds of one minute and the first 10 seconds of the next — is a candidate for behavioral change.

If no keys show this pattern, the migration carries less risk. If several do, those customers need direct outreach before the cutover date. Shipping without this audit means discovering the affected customers through their support tickets after the fact. At 847 active keys including enterprise accounts, that is not an acceptable discovery mechanism.

---

**The Redis schema migration is not a config change. Rolling it out as a standard deploy creates inconsistent enforcement across instances.**

The current schema stores fixed-window state as a string counter: `ratelimit:{api_key}:{epoch_minute}`, with a 60-second TTL. Sliding window log requires a sorted set per key with request timestamps as scores. Sliding window counter requires two string counters per key — current window and previous window — with a 120-second TTL. None of these are the existing schema. There is no in-place migration that converts existing keys.

The three API instances share one Redis instance for rate limit state. During a standard rolling deploy — where Instance 1 is updated while Instances 2 and 3 still run the old code — the following happens for any API key whose requests land on different instances:

- Instance 1 reads and writes sliding-window keys; it sees only the requests it has handled
- Instances 2 and 3 read and write fixed-window keys; they see only the requests they have handled
- No instance has a complete view of how many requests the key has made in the last 60 seconds

During the deploy window, rate limit enforcement is fragmented. A key that is actually at 900 requests might appear at 300 to Instance 1 because the other 600 landed on Instances 2 and 3 and were counted in the old schema. That key gets 1,000 more requests before any instance rejects it.

A safe migration requires all instances to switch schemas simultaneously — either via a feature flag that is flipped atomically across all instances, or by taking Instances 2 and 3 out of rotation before updating Instance 1. A rolling deploy is not safe for this change.

---

### 🟡 Important

**The two sliding window implementations have different cost profiles. Choosing between them should be an explicit decision, not a default.**

Sliding window log stores one sorted set entry per request. At 1,000 requests per minute per key, each key's sorted set holds up to 1,000 entries simultaneously — each entry is a timestamp and a request ID. With 847 keys concurrently active at peak, that is roughly 847,000 live entries in Redis, plus the overhead of ZADD and ZREMRANGEBYSCORE on every rate limit check. These operations are O(log n + k) — not O(1).

Sliding window counter stores two string keys per API key regardless of request volume. Two GET operations, one conditional INCR, O(1). Memory does not grow with request rate. At 2.4 million checks per day, the difference is meaningful at the Redis layer.

The counter approximation introduces a small bounded error: near window transitions, it can permit slightly more requests than the strict limit (if previous traffic was back-loaded) or reject a request that a true sliding window would allow (if previous traffic was front-loaded). The error is bounded but bidirectional. For a payments API where the rate limit is a quota control rather than a security boundary, this bounded inaccuracy is acceptable.

Choosing sliding window log because it is "exact" without quantifying the cost at this scale — and without a specific accuracy requirement that log provides and counter does not — is the wrong trade. The counter is the appropriate default for this workload unless there is a stated reason precision matters more than efficiency.

---

### 🟢 Bonus

**The window duration is a fixed assumption that has never been questioned. It may not be the right one for Meridian or for any customer with bursty workloads.**

The current 60-second window was presumably chosen as a round number, not because a minute is the right unit of time for the API's use case. For a customer running parallelized batch jobs, a 60-second window creates a coordination problem: six jobs firing over 30 seconds consume the entire window's quota with no mechanism for the burst to settle before the next window opens.

A shorter window — 10 or 15 seconds — with a proportionally lower limit (say, 250 requests per 15 seconds rather than 1,000 per 60 seconds) provides equivalent throughput but smoother enforcement. Bursty clients hit the limit sooner but recover faster. Boundary artifacts shrink proportionally to the window size.

This is not necessarily the right change to make. It affects all customers, requires the same migration care as the algorithm change, and may not align with how customers reason about their quotas. But a senior raises the question, because a customer complaint about boundary artifacts is also a signal that the window duration is shaping behavior in ways nobody designed for.

---

## Common Mistakes

- **Starting with the Redis implementation.** The natural instinct when handed "migrate to sliding window" is to open the codebase and start writing sorted set operations. The implementation is the easy part — the sorted set commands are well-documented, the logic is straightforward. The hard parts are upstream: knowing whether the migration breaks existing customers, knowing whether the proposed solution even solves the stated problem, and knowing how to coordinate the schema switch across instances. A learner who writes implementation code before pulling access logs has built in the wrong order.

- **Treating the rolling deploy as safe because it works for everything else.** Rolling deploys are the standard and they are correct for the vast majority of changes. Rate limit schema migrations are one of the narrow cases where they are not, because "consistent enforcement" is a property that requires all instances to agree on the schema at any given moment. A learner who proposes a "gradual rollout over 2 hours" without naming the consistency gap is applying a correct general rule to a case where it does not hold.

- **Accepting the manager's framing as the requirement.** "Sliding window" arrived in the conversation as the manager's read of a customer email. It is a proposed solution, not a requirement. The actual requirement is: Meridian's reconciliation pipeline should not experience unpredictable rate limit rejections under load. Multiple solutions satisfy this requirement. A senior names them, compares them, and either defends the proposed solution or makes the case for a different one. A mid-level implements what was named. The difference shows up when the proposed solution turns out to be insufficient — which, in this case, it likely is.

---

## Reference Reasoning

> This is not the correct answer. It is the reasoning a senior engineer would likely
> apply and the design they would land on. A defensible answer that reaches different
> conclusions through sound reasoning is equally valid.

**Questions a senior asks before designing anything:**

- What exactly is Meridian's pipeline doing — how many concurrent jobs, what call volume per job, and what does their request distribution look like relative to the minute boundary? Is this a client-side concurrency problem or an algorithm problem?
- Of the 847 active API keys, which ones show burst patterns near minute boundaries in the last 30 days? Can we pull access logs and check before committing to a migration plan?
- What is the delivery expectation — designed by Thursday, or deployed by Thursday? And what is the risk tolerance for a behavioral change that affects all 847 customers with no API version bump?

**What they would likely propose:**

First: contact Meridian's integration team before shipping anything. Their root problem is that six jobs fire API calls concurrently with no shared rate limit awareness. A client-side request queue — or simply a rate-aware dispatch pool that all six jobs submit through — fixes the immediate problem in days without server-side risk. Present this alongside the server-side roadmap. If the account team can move Meridian to a client-side fix, the urgency of the server-side migration drops significantly.

For the server-side migration: audit access logs for the last 30 days before writing code. Look for keys with clustered requests across minute boundaries. Contact any affected customers directly with a specific date and description of the change. The behavioral contract change is the highest-risk component of this migration and it is the one that is easiest to check for in advance.

If the migration proceeds: implement sliding window counter, not log. The counter is O(1), stores two integers per key, and its bounded approximation error is acceptable for quota enforcement on a payments API. The log's exact accuracy advantage is not worth the per-request memory growth and log-linear operation cost without a specific accuracy requirement the log satisfies and the counter does not.

For the rollout: use a feature flag checked at the rate limit middleware layer, flipped atomically across all instances — not a rolling deploy. When the flag is on, all instances read and write sliding-window keys; when off, all read and write fixed-window keys. The old fixed-window keys expire within 60 seconds of the cutover. During that 60-second window, the new counters start at zero, which means the limit is effectively permissive for one window. Accept this as the migration cost — it is bounded and permissive, not restrictive.

**What they would explicitly not do, and why:**

- **Implement sliding window log as the default:** The sorted set approach is technically exact, but exactness is not a stated requirement. The counter approximation is O(1), bounded, permissive, and meaningfully cheaper at 2.4M checks per day. Reaching for the accurate implementation without a reason the approximation is insufficient is over-engineering without benefit.

- **Ship as a standard rolling deploy:** Rate limit schema migrations are one of the narrow cases where instance-level disagreement on schema produces actively wrong behavior — not degraded performance, but incorrect enforcement. Inconsistent enforcement during a deploy window is a worse outcome than the problem being fixed. A rolling deploy is the wrong deployment strategy for this specific change.

- **Ship without auditing existing customers:** The behavioral contract change is reversible in code but not in customer relationships. A customer whose pipeline breaks after the migration — because their boundary-burst pattern stopped working — experiences a production incident. Discovering this in a post-migration support ticket when a 30-day log pull would have flagged it in advance is an avoidable failure.

**What risks remain:**

- **The counter approximation introduces a bounded, bidirectional error near window transitions.** Under steady traffic, this is negligible. Under deliberately adversarial traffic (a client timing requests specifically to exploit the permissive side of the approximation), the overage could be larger. Conversely, under highly non-uniform traffic, the restrictive side of the approximation may incorrectly reject legitimate requests. For a payments API enforcing a quota contract, this bounded inaccuracy is acceptable. For a security-critical rate limiter (protecting authentication endpoints, for example), the bidirectional error would need explicit sign-off.

- **Some customers may not respond to pre-migration outreach.** The behavioral change affects any customer relying on fixed-window boundary behavior. Outreach reduces the blast radius but does not eliminate it. A per-key grace period — where keys can opt into fixed-window semantics for a specified transition window — adds implementation complexity but gives non-responsive customers time to adapt without a production incident.
