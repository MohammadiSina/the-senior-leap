# Rate Limiting Algorithms

> Already know the differences between fixed-window, sliding window log, and sliding window counter — including the Redis data structures each uses, the approximation formula for the counter approach, and where each breaks down at scale? Skip this and go straight to `README.md`.

---

Rate limiting controls how many requests a client can send in a given time window. The algorithm you choose determines more than throughput — it shapes what behavior clients can depend on, what you store in Redis at scale, and what breaks when traffic is bursty or unevenly distributed across window boundaries.

This file covers three algorithms: fixed-window, sliding window log, and sliding window counter. The exercise turns on understanding exactly where these algorithms differ — and what the operational consequences of switching between them look like in a live system.

---

## How Each Algorithm Works

### Fixed Window

The simplest implementation. Each time window gets an independent counter.

**Redis implementation:**

```
Key:        ratelimit:{api_key}:{epoch_minute}
On request: INCR key
            EXPIRE key 60   (only on first write, to set TTL)
Check:      if result of INCR > limit → reject
```

Every request increments the counter for the current minute. The key expires naturally after 60 seconds — no cleanup process required. The entire check is one Redis round-trip.

**Cost:** O(1) per request.

**The boundary problem:** Fixed windows are independent of each other. A client can send 1,000 requests in the last two seconds of minute N and 1,000 more in the first two seconds of minute N+1. Both counts are within quota. In a 4-second span the client sent 2,000 requests — double the effective rate — without triggering a single rejection. This is a structural property of the algorithm. It cannot be patched without changing the algorithm.

---

### Sliding Window Log

Tracks the exact timestamp of every request within the current window.

**Redis implementation:**

```
Key:        ratelimit:{api_key}
On request: ZADD key <now_ms> <unique_request_id>
            ZCOUNT key <now_ms − window_ms> +inf
            ZREMRANGEBYSCORE key -inf <now_ms − window_ms>
            EXPIRE key 120
Check:      if ZCOUNT result > limit → reject
```

Each request is added to a sorted set scored by timestamp. To enforce the limit, count all entries from the last 60 seconds. To prevent unbounded growth, remove entries older than 60 seconds on each write.

**Cost:** O(log n) for ZADD, O(log n + k) for ZREMRANGEBYSCORE where k is the number of expired entries removed. Memory scales linearly with request count — each entry stores a timestamp and a unique request ID, not just an increment to a counter.

**The accuracy:** Exact. At any moment, the count reflects precisely how many requests arrived in the last 60 seconds. No boundary artifacts. No approximation.

**The scale implication:** At 1,000 requests per minute per key, each sorted set holds up to 1,000 live entries simultaneously. Memory is proportional to request volume, not just key count.

---

### Sliding Window Counter

Approximates a sliding window using two fixed-window counters. O(1) per request. No per-request memory growth.

**The core idea:** At any moment, you have a complete previous window and a partial current window. The true sliding window count is the number of requests that occurred in the last 60 seconds — which spans part of the previous window and all of the current window so far. You can approximate this without storing individual timestamps.

**The formula:**

```
elapsed   = seconds elapsed into the current 60-second window  (0 to 60)
weight    = 1 − (elapsed / 60)
estimated = (prev × weight) + curr
```

Where `prev` is the total count from the previous complete window and `curr` is the count so far in the current window.

**Worked example:** It is 45 seconds into the current minute window:

- Previous window: 800 requests
- Current window so far: 300 requests
- `elapsed = 45`, `weight = 1 − (45/60) = 0.25`
- `estimated = (800 × 0.25) + 300 = 200 + 300 = 500`

The formula reads: "of the 800 requests in the previous window, roughly 25% of them fall within the last 60 seconds — specifically the final 15 seconds of that window. The rest of the sliding window is covered by the current window's 300 requests."

**What it assumes:** Requests in the previous window were uniformly distributed across it. As you move deeper into the current window, the previous window's contribution shrinks linearly toward zero.

**The bounded error:** The worst case occurs when all previous-window requests were clustered at the end of that window — say, all 800 arrived in the final second. In that case, the formula assigns them weight 0.25 and counts only 200 of them, when the true sliding window would count all 800. The formula *underestimates* the true count: it behaves more permissively than a true sliding window, allowing more requests through near the boundary.

Conversely, if the previous window's requests were heavily clustered at the *beginning* of that window (outside the true 60-second sliding window), the formula still applies the same weight and *overestimates* the true count. It behaves more restrictively, potentially rejecting a request that a true sliding window would have allowed. 

At steady-state traffic — where requests are approximately uniformly distributed — this error is small. The error is bounded but bidirectional depending on the traffic shape of the previous window.

**Redis implementation:**

```
Keys:       ratelimit:{api_key}:{epoch_minute_current}
            ratelimit:{api_key}:{epoch_minute_previous}
On request: GET both keys
            compute estimate inline
            if estimate < limit → INCR current key
            EXPIRE each key 120   (two window durations, to keep previous key alive)
```

Two reads and one conditional write. O(1). Memory cost is two integers per API key, regardless of request volume.

---

## What to Watch For

- **Fixed-window and sliding-window are not semantically equivalent at boundaries.** A client that sends 999 requests at :59 and 999 more at :00 is accepted under fixed-window — each window is under 1,000. Under sliding window, the second batch arrives when the estimated count is 999 + some weight of the previous window, which may exceed the limit. Any client that patterns its requests around window resets is affected by an algorithm change, whether deliberately or as a side effect of retry logic. The change is silent — no API version bump signals it.

- **Sorted set memory scales with request count, not key count.** Fixed-window and sliding window counter both store a constant amount per API key regardless of traffic — one or two integers. Sliding window log stores one entry per request within the window. At high request rates, the log approach is meaningfully more expensive in Redis memory than the counter approximation, even though it is technically more accurate.

- **The counter approximation error is bounded but bidirectional.** The formula can allow slightly more requests than the limit near window transitions (if previous traffic was back-loaded) or incorrectly reject a request that should be allowed (if previous traffic was front-loaded). For quota enforcement — controlling how much a client can do — this bounded inaccuracy is usually acceptable. For rate limiting as a hard security control (e.g., protecting against credential stuffing or abuse), the bidirectional error matters and should be evaluated against the threat model.

---

## Further Reading

- [Stripe Engineering — Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters) — Stripe's production rate limiting architecture. Explains their use of token bucket and leaky bucket, why they chose those over window-based approaches, and the operational reasoning behind each decision. The closest practical reference to what this exercise asks you to reason through.

- [Kong Engineering — How to Design a Scalable Rate Limiting Algorithm](https://konghq.com/blog/engineering/how-to-design-a-scalable-rate-limiting-algorithm) — Covers all major algorithms with Redis implementation detail. The sliding window counter section includes the derivation of the approximation formula with additional worked examples and edge case analysis.

- [Redis Documentation — Sorted Sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/) — Reference for the ZADD, ZCOUNT, and ZREMRANGEBYSCORE commands used in the sliding window log implementation. Pay attention to the time complexity notes — they explain why the log approach has a fundamentally different cost profile than the counter at high request volumes.
