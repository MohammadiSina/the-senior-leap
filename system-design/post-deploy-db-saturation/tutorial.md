# Cache Stampede

> Already comfortable with cache-aside and stampede mechanics? Skip this and go straight to `README.md`.

---

Cache-aside is the most common caching pattern. The application checks the cache first. On a miss, it queries the source of truth (usually a database), returns the result to the caller, and stores it in the cache for future requests.

```
cache_get(key)
  → hit:  return cached value
  → miss: result = db_query(key)
          cache_set(key, result, ttl)
          return result
```

This works well when the cache is warm and misses are rare. The hidden assumption is that misses are spread out enough that the database can absorb them. That assumption breaks when many callers miss on the same key at the same time.

---

## How It Works

A cache stampede happens when multiple callers simultaneously miss on the same key and each queries the database independently. In cache-aside, no caller is aware of the others — each follows the same code path, and the database receives N identical queries in the same moment.

The scale of the problem depends on two things: how many callers are hitting the key per second, and what caused the miss. There are three common triggers.

**Full cache flush.** Every key is evicted simultaneously — for example, by a deploy script that runs `FLUSHDB`. All traffic that was cache-served becomes database traffic at once. If the cache was absorbing 90% of reads, the database suddenly sees 10× its normal query rate. Connection pools exhaust in seconds.

**Hot key TTL expiry.** A single very popular key reaches its TTL and expires. The next batch of requests all miss and all query the database within the same millisecond window. Less catastrophic than a full flush but can still cause connection pool pressure on a high-traffic key.

**Cache restart.** Equivalent to a full flush, unscheduled. Redis restarts empty.

The common thread: the database receives redundant, concurrent queries for the same data, and the application has no mechanism to coordinate them.

---

## What to Watch For

**Request rate stays flat during the incident.** A cache stampede does not require a traffic spike. Incoming request volume can be completely normal while the database is overwhelmed. If you see connection pool exhaustion with no corresponding traffic increase, the cache is the first place to look — not the load balancer, not a traffic surge, not a DDoS.

**Cache hit rate and DB connections move inversely at the same moment.** When a stampede begins, cache hit rate drops and DB connection count rises simultaneously. The time between these two events is the latency of cache miss → DB query → connection pool pressure — often just a few seconds.

**Recovery is not uniform across all keys.** After a full flush, the cache repopulates key by key, on first access. Frequently requested keys (hot keys) rebuild within seconds. Infrequently requested keys (cold keys) rebuild slowly — a cold key only gets rebuilt the first time a request for it arrives after the flush. If the baseline cache hit rate is 94% but the hit rate after partial recovery is 72%, that remaining 22% is the cold key tail. During that tail, the database is still serving those misses, and the load does not disappear just because the application looks healthy again.

**Standard protection mechanisms:**

*Mutex / single-flight lock.* When a cache miss occurs, the first caller acquires a short-lived distributed lock for that key. Other callers for the same key wait on the lock (or return stale data if the application can tolerate it) rather than querying the database independently. When the lock holder populates the cache, all waiters read the new value. This collapses N concurrent database queries per key into 1. The lock must have a timeout with a fallback — waiting indefinitely for a lock on an unavailable cache is worse than the stampede it prevents.

*Probabilistic early expiration.* Instead of expiring a key hard at its TTL, each request near the TTL boundary has a small probability of proactively rebuilding the key before it expires. A background rebuild happens while the key is still live, so no caller ever sees a cold miss on a hot key. Does not help with a full flush — all keys go cold simultaneously regardless of how they were expiring before.

*Background refresh.* A dedicated process keeps hot keys warm by rebuilding them before expiry. Callers never see a miss on hot keys. Requires identifying which keys are hot and running a separate process to maintain them, which adds operational complexity.

---

## Further Reading

- [Redis documentation: Cache stampede](https://redis.io/glossary/cache-stampede/) — brief overview with code examples for the lock-based approach
- [Thundering herd problem](https://en.wikipedia.org/wiki/Thundering_herd_problem) — the more general form of this failure mode, applicable beyond caching
