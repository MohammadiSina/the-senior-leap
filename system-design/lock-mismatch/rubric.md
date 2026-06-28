# Rubric — Lock Mismatch

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.
>
> This file also serves as the reference solution — see the Reference Reasoning section at the end.

---

## What a Senior Engineer Would Notice

---

### 🔴 Critical

**The lock TTL is 60 minutes. P99 job duration is 72 minutes. At the 99th percentile, jobs outlive their lock.**

At P50, jobs complete in 12 minutes — well inside the TTL, no problem. At P99, a job runs for 72 minutes: 60 minutes into execution, the lock expires. At that moment, any of the other five worker instances is free to acquire the lock and start a new aggregation run for the same customer. Job A continues executing for another 12 minutes, unaware that the lock is gone. Job B begins its run from scratch, reading the same raw events. Both jobs write to the same aggregate store simultaneously. Every aggregate record written during the overlap window is produced twice. This is the mechanism behind all seven support tickets.

The relationship between these two numbers — TTL and P99 job duration — lives in two different places: Redis configuration and application performance metrics. Nobody thought to put them next to each other. Both investigations confirmed the lock implementation was correct, which it is. Neither checked whether the TTL is large enough to cover the worst-case execution time of the thing it's protecting.

**Once the lock TTL expires, Job A receives no signal. It continues executing for the full remaining duration, unaware.**

Even if the TTL is eventually corrected, a more fundamental issue remains: the executing job has no mechanism to detect that its lock was lost. There is no expiry notification, no heartbeat failure, no error thrown. Job A writes aggregate records for another 12 minutes believing it is the sole writer, because as far as its own process state is concerned, it acquired the lock successfully and nothing has told it otherwise.

This means there is no TTL value that fully solves the problem through TTL alone. A TTL of 3 hours reduces the frequency of expiry during normal execution but cannot prevent it for a sufficiently slow job. As load grows and P99 rises, the hazard resurfaces. Correctly fixing this requires either (a) periodic lock renewal so the job continuously holds its lock for as long as it is executing, or (b) idempotent job design so that two simultaneous runs produce the same result as one.

---

### 🟡 Important

**Before designing any fix, a senior asks whether the aggregation job is idempotent. The answer determines the entire fix strategy.**

Idempotency here means: if the job runs twice for the same customer in the same hour — overlapping writes to the same aggregate store — does the final state reflect one correct run or two corrupted ones? If the job uses UPSERT semantics keyed on customer + time window, two simultaneous runs overwrite each other safely and the result is correct. The lock becomes a pure optimization against wasted compute, not a correctness mechanism. An extended TTL plus alerting on long-running jobs may be sufficient.

If the job uses INSERT without deduplication, or if its aggregation logic is additive without a guard (e.g., `UPDATE stats SET count = count + delta`), then two simultaneous runs corrupt the data. The lock is a correctness mechanism and must be maintained for the full duration of every job via heartbeat renewal.

A senior does not propose heartbeat renewal without first establishing that idempotency isn't the simpler answer. A senior does not propose "just make it idempotent" without verifying that idempotency is achievable for this specific computation. This is the question that forks the decision tree. Missing it means proposing a fix without knowing whether it's the right kind of fix.

---

### 🟢 Bonus

**The junior engineer's observation about load-correlated clusters is the diagnostic smoking gun — and nobody followed up on it.**

Ticket clusters correlating with high-traffic periods is not a coincidence and is not noise. It is a direct prediction of the TTL/P99 relationship: under high load, jobs run slower. More jobs push past P99. More locks expire during execution. More duplicates are produced. The cluster pattern would be expected even without access to the job duration metrics — and it points directly at a load-dependent timing failure rather than a code bug or data corruption.

A senior who reads that observation immediately asks: what changes about job behavior during peak traffic? That question has a precise answer here, and it leads to the root cause in under a minute of reasoning. Flagging a junior's offhand observation and treating it as the most important data point in the thread is a senior move. It's also what the actual investigation needed.

---

## Common Mistakes

**Seeing `SET NX EX` and concluding the lock is correctly implemented.** The atomic syntax is correct. The problem is not how the lock is acquired — it's the relationship between how long the lock remains valid and how long the protected operation takes. These are two separate numbers that live in two separate places, and the investigation correctly confirmed the first without ever looking at the second.

**Proposing "extend the TTL to 3 hours" as the complete fix.** This is a mitigation, not a solution. Any TTL can be outlived by a sufficiently slow job. Under continued load growth, P99 will rise. The underlying hazard — that an executing job has no awareness of lock expiry — is unchanged. Extending the TTL reduces frequency of the failure but does not address the mechanism. A candidate who stops here is fixing the number without understanding the problem.

**Jumping directly to heartbeat renewal without first asking whether idempotency makes the lock a correctness mechanism.** Heartbeat renewal is the right fix when the job is not idempotent. But if the job is already idempotent, heartbeat renewal adds complexity to solve a problem that doesn't exist. The idempotency question is the prerequisite, not an afterthought.

---

## Reference Reasoning

> This is not the correct answer. It is the reasoning a senior engineer would likely apply and the design they would land on. A defensible answer that reaches different conclusions through sound reasoning is equally valid.

**Questions a senior asks before designing anything:**

- Is the aggregation job idempotent? Specifically: if two instances write aggregates for the same customer in the same time window simultaneously, does the final stored state reflect one correct run? This determines whether the lock is a correctness mechanism or an optimization.
- What does the write path look like — INSERT, UPSERT, or an additive UPDATE? This is how you answer the idempotency question if the code isn't immediately obvious.
- What does P99 job duration look like specifically during high-traffic periods? The overall P99 is 72 minutes, but the cluster observation suggests peak-traffic behavior may be worse.
- How was the 60-minute TTL chosen? Understanding the original reasoning often reveals what assumption was missed.

**What they would likely propose:**

*If the job is idempotent:*

Extend the TTL to 3–4× the observed P99 (e.g., 4 hours) as an immediate mitigation. Add alerting when any job runs past a threshold (e.g., 45 minutes) so long-running jobs surface before they become incidents rather than after. Accept residual risk: at an extreme P99 — a job taking longer than 4 hours — two instances may run simultaneously, but since the job is idempotent, the result is wasted compute, not corrupted data. Separately investigate why P99 is 72 minutes; the job may have optimization headroom.

*If the job is not idempotent:*

Implement heartbeat-based lock renewal: the job periodically (e.g., every 5 minutes) attempts to renew its lock TTL. The renewal must be conditional — using a Lua script or a transaction that verifies the lock value matches the worker ID before extending it, so a job that has already lost its lock cannot accidentally reclaim it. In addition, add a pre-write check: before writing each batch of aggregate records, the job verifies it still holds the lock. If the check fails, the job aborts immediately rather than writing into a window another job has already claimed. Keep the original 60-minute TTL (or set it to 90 minutes) as a dead-worker cleanup mechanism — TTL now serves only to release locks from crashed workers, not to bound healthy execution time.

**What they would explicitly not do, and why:**

- Just extend the TTL to 3 hours and close the ticket. The underlying issue — no awareness of lock loss — remains unaddressed. The next time P99 exceeds whatever the new TTL is, the tickets resume. This fix has a fixed shelf life rather than actually solving the problem.
- Switch to Redlock or a multi-node Redis quorum lock. Overkill for this scenario. The problem is not lock consistency across Redis nodes — a single Redis instance is fine. The problem is TTL configuration and job-side awareness of lock expiry. Redlock doesn't help with either.
- Add a database-level unique constraint as the primary correctness fix. A unique constraint on the aggregate store would prevent duplicate records from being committed, but it would do so by surfacing errors that the application then has to handle — and it doesn't address the wasted compute of two simultaneous full job runs. It's a useful defense-in-depth measure, not a replacement for fixing the lock.

**What risks remain:**

- Heartbeat renewal assumes the job can check the lock value before each write. If the aggregation logic writes in a single large transaction rather than incremental batches, instrumentation points may be limited without significant refactoring. This is acceptable: partial instrumentation (check at job start, check before the final write commit) is better than no instrumentation.
- Under severe application instance degradation — long GC pauses, network partition to Redis — a heartbeat renewal can fail silently, allowing the lock to expire even for a healthy job. This is acceptable: the correct response to a failed heartbeat renewal is to abort the job and surface an alert, not to continue writing. An alert on heartbeat failure is part of the fix.
- The root cause of why P99 reaches 72 minutes under peak load has not been addressed. This is a separate investigation, not an excuse to skip it — if job duration is rising with platform load, there may be a resource contention problem worth fixing independently of the lock strategy.
