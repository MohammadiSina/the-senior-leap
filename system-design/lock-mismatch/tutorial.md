# Distributed Locking with Redis

> Already comfortable with Redis distributed locks, TTL semantics, and heartbeat renewal? Skip this and go straight to `README.md`.

---

Distributed locks solve a problem that arises when multiple application instances need to coordinate access to a shared resource: how do you ensure that only one instance executes a critical section at a time, when the instances share no in-process state?

Redis is a common choice for distributed lock storage because it is fast, single-threaded (so lock operations are serialized), and supports atomic commands that combine "check if key exists" and "set the key" into a single operation.

---

## The Broken Pattern: SETNX + EXPIRE

The naive approach uses two commands:

```
SETNX customer:42:lock worker-1     # set only if not exists
EXPIRE customer:42:lock 60          # set expiry
```

`SETNX` returns 1 if the key was set (lock acquired) and 0 if it already existed (lock held by someone else). The `EXPIRE` command sets a TTL so the lock doesn't remain forever if the acquiring process crashes.

This pattern has a race condition. If the application crashes or is killed between the `SETNX` and the `EXPIRE`, the lock is never given an expiry. It stays in Redis indefinitely, and no other instance can ever acquire it. The resource is permanently locked out.

---

## The Correct Pattern: Atomic SET NX EX

The atomic form combines both operations into a single command:

```
SET customer:42:lock worker-1 NX EX 3600
```

`NX` — only set if not exists. `EX 3600` — set expiry to 3600 seconds. Because this is a single atomic command, there is no window between setting the key and setting the TTL. If the process crashes immediately after, Redis still has the expiry and will release the lock after 3600 seconds.

The return value is `OK` if the lock was acquired, or `nil` if the key already existed.

To release the lock, the holder deletes the key — but only after verifying that the key's value still matches its own worker ID, to avoid accidentally releasing a lock someone else has already acquired:

```lua
-- Lua script, executes atomically in Redis
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

---

## What TTL Is For

The TTL serves one purpose: **cleanup if the lock holder dies**. If a worker crashes mid-job without releasing the lock, the TTL ensures the lock eventually expires so another worker can proceed. Without TTL, a crashed worker leaves the resource permanently locked.

This implies an important design assumption: **the TTL should be long enough that a healthy job always finishes before the lock expires.** If the lock expires while the job is still running, it effectively releases the lock on a live process — which is not what TTL is designed to do.

---

## Heartbeat Renewal

For jobs that may run for variable or unpredictable durations, a fixed TTL creates tension: too short and healthy jobs lose their locks; too long and crashed workers hold locks for a long time before cleanup.

The heartbeat pattern resolves this by having the job periodically renew the lock TTL while it's still executing:

```
// Every 30 seconds, if the job is still running:
// Verify we still hold the lock, then extend its TTL
```

The renewal must be **conditional**: before extending the TTL, the job verifies that the lock value in Redis still matches its own worker ID. If another instance has already acquired the lock (because the TTL previously expired), the job should not reclaim it by extending the TTL — it should detect the loss and abort.

This keeps the lock alive for as long as the job is healthy and executing, while still allowing cleanup after a crash (the heartbeat stops when the process dies, and the TTL runs to expiry).

---

## Idempotency and Why It Matters for Locks

A lock-protected operation is **idempotent** if running it twice produces exactly the same result as running it once. For an aggregation job: does writing the same set of aggregates twice leave the data store in the same state as writing them once?

This property determines how much correctness work the lock has to do:

- **If the operation is idempotent:** Two simultaneous runs produce the same final state. The lock is purely an optimization — it prevents wasted work (two instances computing the same thing), but it is not a correctness mechanism. A loose TTL is acceptable.
- **If the operation is not idempotent:** Two simultaneous runs produce corrupt or doubled data. The lock is a correctness mechanism and must be held for the entire duration of the operation. Any gap in lock coverage — including expiry during execution — produces incorrect results.

Whether a job is idempotent depends on how it writes: an UPSERT keyed on a natural identifier tends toward idempotency; an INSERT or an additive UPDATE (`SET count = count + delta`) does not.

---

## What to Watch For

- The atomic `SET NX EX` pattern eliminates the SETNX + EXPIRE race condition, but it does not make the TTL choice correct. The mechanism can be right while the TTL value is still wrong.
- TTL expiry during execution produces no notification to the lock holder. The holder continues executing as if the lock were still valid unless it explicitly checks.
- Heartbeat renewal requires care: the renewal should be conditional on the lock value still matching, to avoid accidentally reclaiming a lock that has already passed to another worker.

---

## Further Reading

- [Martin Kleppmann — "How to do distributed locking"](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) — a careful walkthrough of what correctness actually requires from a distributed lock, with honest discussion of where Redis locking falls short under network partition. Worth reading if you want a deeper treatment of the guarantees the pattern does and does not provide.
