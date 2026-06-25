# Rubric — Post-Deploy DB Saturation

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.
>
> This file also serves as the reference solution — see the Reference Reasoning section at the end.

---

## What a Senior Engineer Would Notice

---

### 🔴 Critical

**The deploy is not the root cause. The 14:22:08 row rules out a traffic surge and points directly at the cache flush with no rebuild coordination.**

Request rate at 14:22:08 is 342 req/s — two requests above the 14:21:50 baseline of 340. No meaningful traffic change occurred. Cache hit rate dropped from 94% to 0% at exactly 14:22:00, coinciding with `FLUSHDB`. Database connections went from 12 to 100 in eight seconds — not because incoming traffic increased, but because traffic that had been served from cache was now hitting the database all at once. An engineer who reads "deploy → outage" and attributes this to a bad deploy has pattern-matched the timeline without reading the metrics. The correct root cause: cache-aside with no concurrent rebuild coordination, combined with a full cache flush at normal traffic levels. These are not the same as "bad deploy," and the action item does not address them. A rollback initiated at 14:23:00 would have re-executed the deploy script — including `FLUSHDB` — in the other direction. The stampede would recur immediately.

**Before proposing any solution, a senior confirms the caching pattern. The answer determines the entire fix.**

The evidence strongly implies cache-aside: a cache miss results in a direct database query by the calling API instance, with no other coordination. But a senior asks explicitly, because the answer changes everything. Write-through caching would produce a different evidence signature — the DB connection spike would follow write traffic, not read traffic. A background refresh pattern (a dedicated process keeps keys warm; misses return stale data rather than hitting the DB) would not produce a DB spike from a flush at all. Confirming cache-aside is not pedantry — a mutex-based stampede lock is the right fix for cache-aside; it is the wrong fix for a background refresh pattern where the database is not on the read path. Designing a solution without confirming the pattern risks building the wrong thing entirely.

**The `FLUSHDB` command was a convenience, not a correctness requirement. A senior questions whether the deploy script actually needed to drop the entire cache.**

The scenario states the flush happened because a stale cached object missing the new `last_updated_by` field would cause deserialization errors. A senior engineer immediately asks: why can't the new code simply tolerate the missing field (e.g., defaulting to `null` or `"system"`) during the rollout window? If the application can gracefully handle the old object shape, the global `FLUSHDB` was entirely unnecessary. Even if invalidation was required, it could have been done via versioned cache keys (e.g., `product:v2:{id}`) rather than a global wipe that forces 850,000 simultaneous rebuilds. Treating a global cache flush as a mandatory deploy step for a single additive field turns a preventable process choice into an unavoidable architectural outage.

---

### 🟡 Important

**The incident was declared resolved eight minutes before the system actually recovered, exposing a monitoring gap that leaves the database vulnerable to a secondary shock.**

At 14:28:30, on-call declared the incident resolved because application-level metrics looked healthy: error rate at 0.4% and p99 latency at 95ms. But the database metrics tell a different story: DB connections were at 31/100 (baseline: 12) and DB CPU was at 61% (baseline: 8%). The cache hit rate was only 72% because cache recovery after a flush is non-linear. Hot keys, which see frequent traffic, rebuilt quickly within the first two minutes. But the remaining 22% of the cache consists of cold keys — infrequently requested data that only gets rebuilt one at a time upon its first access. This long-tail recovery means the database was still absorbing a steady stream of cold-key misses, keeping DB connections elevated. The system was not recovered; it was just absorbing the rebuild load without throwing application errors. By relying solely on error rate and p99 latency to declare recovery, the team missed that their database headroom was still severely compromised. If a traffic spike or a slow query had occurred in those final eight minutes, the database would have collapsed again with no warning.

---

### 🟢 Bonus

**This incident was survivable because the deploy ran at near-baseline traffic. The same event at peak would have cascaded faster than on-call could respond.**

The connection pool exhausted in eight seconds at 340 req/s. The exercise does not state peak traffic, but a senior asks: when is deploy window, and what does the system look like at peak? At 2× traffic (680 req/s), pool exhaustion takes roughly four seconds — half the time before detection, half the time to initiate any response. At 3×, approximately three seconds: below any realistic human reaction loop. The absolute floor of detection plus response is bounded by on-call reaction time, not by architectural properties. A senior who notices this raises it unprompted in the post-mortem: "we got lucky with the timing." That observation is not pessimism — it frames the urgency of the fix correctly. An organization that treats this as a recoverable incident because it was recovered from has not read its own timeline carefully.

---

## Common Mistakes

- **Attributing the outage to the deploy and designing a better rollback.** This is the natural error because the deploy and the outage are temporally correlated. The proposed action item in the retrospective draft is wrong for a specific reason: rolling back at 14:23:00 would re-execute the deploy script — `FLUSHDB` included — causing an identical stampede in the other direction. Beyond that: even a rollback procedure that somehow avoided re-flushing would not address the structural weakness, which is that any future full cache flush at current traffic levels will produce the same result.

- **Proposing to stop flushing the cache on deploys.** This is a workaround for one trigger, not a fix for the structural weakness. The same failure mode occurs when a TTL expires on a high-traffic key and many callers simultaneously try to rebuild it (a per-key stampede), when Redis restarts unexpectedly, or when Redis evicts keys under memory pressure. Removing `FLUSHDB` from the deploy script eliminates the most dramatic trigger while leaving all others intact.

- **Proposing to increase the database connection pool.** A larger pool delays exhaustion but does not prevent it. At 340 req/s with a full cache flush, a pool of 200 connections exhausts in roughly 16 seconds instead of 8 — still well within the window before on-call can respond, and still guaranteeing an outage once exhausted. The ratio of concurrent cache misses to available connections is the problem; adding connections changes the ratio without changing the mechanism that produces it.

---

## Reference Reasoning

> This is not the correct answer. It is the reasoning a senior engineer would likely apply and the design they would land on. A defensible answer that reaches different conclusions through sound reasoning is equally valid.

**Questions a senior asks before designing anything:**

- Is this definitively cache-aside? Specifically: does a cache miss result in a direct database query by the calling API instance with no other coordination layer?
- What is the concurrency model on cache writes today? If two API instances both miss on the same key at the same time, do they both query the database independently?
- Does `FLUSHDB` serve a purpose that per-key invalidation could not? The schema change added one field to the cached object — does that require invalidating keys unrelated to the product schema?
- What does peak traffic look like, and when are deploys scheduled relative to peak?
- Was the `FLUSHDB` actually required for this specific deploy, or could the new code tolerate the old object schema during the transition?
- What signals actual database recovery, as opposed to just application-level stability?

**What they would likely propose:**

Confirm cache-aside first. Then address the root cause at two levels, because there are two distinct failure modes — a deploy-time trigger and an always-present structural weakness.

For the deploy-time trigger: address the root cause that a global `FLUSHDB` was used as a convenience for an additive schema change. First, enforce tolerant deserialization: the new `last_updated_by` field should be optional in the application's data model (e.g., defaulting to `null` when missing from the cache). This allows old and new application versions to safely read the same cached objects during a rollout, eliminating the need for `FLUSHDB` entirely. If a cache flush is ever strictly required for a breaking change, use versioned cache keys (`product:v2:{id}`) or targeted invalidation so old and new namespaces coexist without overlapping, rather than wiping all 850,000 keys at once.

For the structural weakness (which persists even after eliminating `FLUSHDB`, because natural TTL expiry on hot keys produces the same problem at smaller scale): implement a mutex or single-flight pattern on cache misses. When a cache miss occurs, the first caller acquires a short-lived distributed lock for that key, queries the database, and populates the cache. All other callers for the same key either wait on the lock or return stale data (depending on tolerance) rather than querying the database independently. This collapses N concurrent database queries for the same key into 1, regardless of what caused the miss. At 340 req/s across 850k keys, the per-key collision probability under normal conditions is low — but it becomes guaranteed across all keys simultaneously under any full flush, and it is a real risk on the top ~0.1% of keys under normal TTL expiry.

These two changes target different failure modes. Targeted invalidation removes the most dangerous trigger. The mutex addresses the underlying concurrency problem and handles every other trigger.

For monitoring: add DB CPU and DB connection ratio (active/pool size) to the incident recovery checklist. Define recovery as: error rate below threshold AND DB metrics within 10% of baseline. The current recovery signal (error rate + p99) measures application output, not database headroom.

**What they would explicitly not do, and why:**

- Increase the database connection pool — delays exhaustion at the current traffic level, does not prevent it. As traffic grows, the same incident recurs at a higher watermark. The fix is reducing concurrent misses per key, not giving more misses a slot.
- Add circuit breakers on the database read path — correct as a resilience pattern for other failure modes, but does not address the root cause here. A circuit breaker that trips on connection exhaustion drops requests that would have been served if the cache had been populated. It is a degradation mechanism, not a stampede prevention mechanism.
- Switch to write-through caching — would require changes across the entire write path, which is a much larger migration than fixing the read path. The system is read-heavy (94% cache hit rate); the write path is not the problem. Write-through also does not help for a full flush, because the cache still starts cold after the flush regardless of whether it was populated on read or write.

**What risks remain:**

- Redis restart or eviction still causes a full or partial stampede. The mutex addresses concurrent rebuilds of the same key but requires Redis to be available to acquire the lock. If the lock cannot be acquired (because Redis is down), the fallback must be: allow the request through to the database without the mutex, degrade gracefully rather than hang. An implementation that waits indefinitely for a Redis lock when Redis is unavailable converts a cache outage into a full application hang. The lock timeout and fallback behavior must be explicit in the implementation.
- Targeted key invalidation requires knowing which cache keys are affected by a given schema change. For a uniform change to all product keys, this is straightforward. For schema changes that affect a subset of keys (feature flags, A/B tests, customer-specific data), the invalidation logic becomes more complex and the risk of under-invalidating (stale data served) or over-invalidating (unnecessary misses) increases. This is a process and tooling risk as much as an architectural one.
- The monitoring gap (recovery declared before DB metrics normalize) is a runbook change, not an architectural one. It requires buy-in from the on-call rotation and will not survive if it is not embedded in the incident tooling. There is a realistic risk it erodes over time.
- Additive schema changes will continue to happen. If the team does not enforce tolerant deserialization or cache key versioning as a standard practice, the next developer might re-introduce a "necessary" `FLUSHDB` out of fear of deserialization errors. This is a process and code-review risk as much as an architectural one.
