# Rubric — Queue Disaster

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.
>
> This file also serves as the reference solution — see the Reference Reasoning section at the end.

---

## What a Senior Engineer Would Notice

---

### 🔴 Critical

**The 05:30 UTC entry ends the conversation before it starts — and most engineers don't read it carefully enough.**
The timeline says the 500k test consumed 25% of the account's monthly send quota. Monthly quota is therefore 2 million messages. The 4M campaign requires 200% of monthly quota before accounting for the 500k test that already ran, normal transactional volume, and whatever else the account sends this month. No queue architecture makes this campaign possible under the current provider contract. A senior's first question is not "how do we scale the workers" — it is "can the provider actually send 4M messages this month?" Every design proposal that doesn't start with this question is built on an assumption that may make Friday's campaign impossible regardless of how the queue is built.

**The workers produce duplicates on every crash, and at 4M messages the crash rate will be higher, not lower.**
Workers dequeue messages in batches of 500 using RPOPLPUSH. When a worker crashes, its in-flight batch sits in the in-flight set until the recovery job re-enqueues it — typically 60–90 seconds later. The recovered messages go back into the main queue and are processed again by a fresh worker. Because no deduplication key is passed to the email provider, the provider treats each re-send as a new request. In the 500k test, 4 workers each crashed once, producing 8,400 duplicates. At 4M messages with the same crash rate per message, duplicates scale proportionally. If on-call scales to 16 workers (as they did at 04:09), the number of in-flight batches that can crash simultaneously quadruples — 16 potential 500-message batches versus 4 — which multiplies duplicate exposure, not reduces it. Adding workers without fixing this is exactly the wrong response to the test result.

---

### 🟡 Important

**The heap growth in the metrics table is not a memory misconfiguration — it is unbounded in-flight state caused by missing back-pressure.**
Worker heap grows from 285MB at 03:08 to 1,400MB at 03:52, a 5x increase over 44 minutes during which queue throughput slows by 70%. This is not a tuning problem. When the email provider starts returning 429s at 03:47, workers enter retry backoff loops — but they continue pulling new messages from the queue. Each new batch enters memory. Retrying messages from earlier batches also stay in memory until resolved. There is no mechanism that says "I'm saturated, stop giving me more work." The heap grows because in-flight state accumulates without bound when the downstream is slow. The fix is not more memory — it is a consumption rate limiter that slows or pauses queue pulls when retry depth exceeds a threshold. The 04:09 scale-out to 16 workers appeared to fix it because fresh workers start with empty heaps, but the underlying dynamic is unchanged. Under 4M messages with the same 429 behavior from the provider, a fresh cascade will begin within the first hour.

---

### 🟢 Bonus

**There is no mechanism to stop a campaign in flight, and at 4M messages that gap becomes an incident waiting for a name.**
If the email provider flags the account for unusual volume mid-campaign on Friday — a rate policy trigger, a spam complaint threshold, an automated abuse detection — there is no killswitch. The workers will continue consuming and attempting sends until someone kills them manually, which triggers a cascade crash and re-enqueue cycle, which produces duplicates. A senior would ask before Friday: what is the pause mechanism? Can the dispatcher be told to stop enqueuing? Can workers be put into drain mode (finish current batch, don't pull new ones)? At 50k messages per day, this gap is manageable. At 4M in a single job, it is a reasonable concern to name even if nobody asked.

---

## Common Mistakes

- **Proposing to add more workers as the primary fix.** The intuition is: more workers means more throughput means faster delivery means less time for things to go wrong. The problem is that more workers means more parallel in-flight batches, which means more batches re-queued on crash, which means more duplicates. The 500k test produced 8,400 duplicates with 4 workers. The same crash rate with 16 workers would produce proportionally more. Worker count is not the variable that matters — idempotency is.

- **Treating the 429 errors as a throughput problem to solve with horizontal scaling.** 429 means the provider is telling you to slow down. Adding workers makes each individual worker hit the rate limit faster, not less. The total request rate across all workers is what the provider caps, not the rate per worker. A learner who proposes "distribute the sends across more workers to stay under the limit" has the causality backwards: the limit is per account, so more workers means hitting the limit sooner per worker, not spreading it out.

---

## Reference Reasoning

> This is not the correct answer. It is the reasoning a senior engineer would likely
> apply and the design they would land on. A defensible answer that reaches different
> conclusions through sound reasoning is equally valid.

**Questions a senior asks before designing anything:**

- What is the monthly send quota on the provider account, and how much of it remains after the 500k test and normal weekly volume? (If the quota is 2M and roughly 500k is already consumed, Friday's campaign at 4M is impossible without a contract conversation. Architecture is irrelevant until this is answered.)
- Does the email provider's API support a deduplication or idempotency key parameter?
- Is the provider's rate limit per account or per sending domain? What is it, in messages per second?
- What is the acceptable duplicate rate for this campaign? Zero tolerance, or is a small percentage acceptable if it comes with a faster delivery window?

**What they would likely propose:**

First, before any engineering: confirm quota headroom with the provider account team. If 4M exceeds the current monthly quota, the answer is either a contract upgrade, phased delivery across multiple billing periods, or delaying the campaign. No queue change touches this.

Assuming quota is confirmed:

1. **Add an idempotency key to every email send.** Key format: `{campaign_id}:{recipient_id}`. Stable across retries, unique per logical send. The provider deduplicates on its end. This converts crash-driven re-sends from a correctness event (duplicate email) to a performance event (wasted API call). This is the highest priority fix because it is the only change that prevents duplicate emails.

2. **Reduce batch size from 500 to 50, or add per-message checkpointing.** Smaller batches reduce duplicate exposure per crash without requiring a different queue mechanism. At batch size 50, a worker crash produces at most 50 duplicates before idempotency keys prevent re-sends. This is a redundant safety layer on top of the idempotency fix, not a replacement.

3. **Add a centralized rate limiter in Redis (token bucket) scoped to the provider's account-level rate limit.** All workers share the limiter. Worker count can scale freely without multiplying API calls beyond what the provider allows. This prevents 429s under the "more workers" scenario and is the correct response to hitting rate limits — not "add more workers."

4. **Add back-pressure to the queue consumer.** When a worker's retry depth (messages currently pending a re-attempt) exceeds a configurable threshold, the worker pauses pulling new batches from the main queue. This bounds heap growth without requiring larger instances.

5. **Phase the campaign if the delivery window allows it.** 500k per day over 8 days respects rate limits, stays within monthly quota, and gives the team the ability to stop after day 1 if something goes wrong with the remaining 3.5M unsent.

**What they would explicitly not do, and why:**

- **Scale workers as the first response** — More workers increases the number of in-flight batches that can crash simultaneously, which increases duplicate exposure. This is the wrong direction given the test result. Worker count is tuned after correctness is established, not before.

- **Switch to SQS, RabbitMQ, or Kafka** — SQS standard queues also guarantee at-least-once delivery; switching doesn't change the duplicate problem. Kafka's exactly-once semantics are possible but require careful producer and consumer configuration and still don't eliminate the need for idempotency keys at the provider level. The queue technology is not the root cause. Changing it costs weeks and produces no correctness improvement.

- **Increase batch size for efficiency** — Counterintuitive but wrong for this scenario. A batch of 1,000 produces 2x the duplicate exposure per crash as a batch of 500. A learner who suggests larger batches to "reduce RPOPLPUSH overhead" is optimizing the wrong variable.

- **Add more memory to the worker instances** — Heap growth is caused by unbounded in-flight state accumulation under downstream pressure, not by insufficient heap size. More memory delays the crash by minutes. It does not change the accumulation dynamics.

**What risks remain:**

- **Provider rate limit constrains the delivery window regardless of changes.** If the provider caps sends at, say, 500 per second account-wide, 4M messages take a minimum of 2.2 hours. If the marketing team has a specific delivery window shorter than that, no engineering change helps. This needs to be stated explicitly to stakeholders before Friday.

- **Phased delivery introduces user state consistency risk.** If a user unsubscribes between day 1 and day 5 of a phased campaign, does the campaign respect that? This is outside the scope of the queue architecture but must be handled in the dispatcher logic. Worth naming even if it is not the engineer's problem to solve.

- **The recovery job's 60-second polling interval creates a delivery gap during cascade crashes.** When 4 workers crash in rapid succession, their in-flight sets all enter the recovery timeout simultaneously. Up to 2,000 messages (4 batches of 500) sit unprocessed for up to 90 seconds. At 4M messages this is a minor throughput concern, not a correctness one — but worth reducing the polling interval or switching to a smarter recovery trigger.
