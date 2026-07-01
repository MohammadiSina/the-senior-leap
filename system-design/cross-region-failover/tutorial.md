# MySQL Replication, Automated Failover, and Split-Brain

> Already comfortable with async vs. semi-sync replication and Raft-based failover tools? Skip this and go straight to `README.md`.

---

Production MySQL deployments rarely run a single database server. The common pattern is one *primary* that accepts writes and one or more *replicas* that receive a copy of every write and serve reads. When the primary fails, a replica is promoted to take its place. How replication works — and how that promotion happens — is what this tutorial covers.

---

## How MySQL Replication Works

When an application writes to a MySQL primary, the primary records the write to its *binary log* (binlog) and applies it locally. Replicas connect to the primary and stream that binlog, applying each event to their own copy of the data. The key question is: **when does the primary tell the application the write is done?**

**Asynchronous replication (the default):** The primary confirms the write to the application as soon as it commits locally — before any replica has acknowledged receiving it. Replication to replicas happens in the background, on a best-effort basis. This is fast: the write latency seen by the application is the time to commit on the primary alone, with no dependency on replica response times.

The cost: if the primary fails before a write replicates, that write exists only on the now-unavailable primary. Any replica promoted to take its place is missing that write. The replica doesn't know it's missing anything — from its perspective, it has a complete and consistent copy of the data up to the point it last received from the primary.

**Semi-synchronous replication:** The primary commits the write locally but does not confirm it to the application until at least one replica acknowledges receiving the binlog event. "Receiving" means the write has landed in the replica's relay log — not necessarily applied, but received. This narrows the durability window: even if the primary fails immediately after confirming, at least one replica has the write.

The cost: every write now waits for a round-trip to the nearest acknowledging replica. In the same data center, this is microseconds and negligible. Across data centers with geographic distance, this is the full network round-trip — potentially tens of milliseconds on every committed write.

---

## Automated Failover and Raft Consensus

Promoting a replica to primary manually, under incident pressure, is slow and error-prone. Tools like GitHub's Orchestrator automate this: they monitor replication topology, detect primary failures, select the best replica to promote, and apply the change automatically.

Orchestrator uses **Raft consensus** to coordinate decisions across multiple Orchestrator nodes. Raft requires a majority quorum to make a decision — in a three-node cluster, any two nodes can elect a leader and issue commands without the third. This design means the failover system itself remains available even when one site is unreachable.

Orchestrator can be configured with a *promotion scope*: which replicas are candidates for promotion, under what conditions, and under what topological constraints. The scope is the configuration that determines not just *whether* Orchestrator acts, but *what topology it can create*.

**What to watch for:** Orchestrator's Raft quorum is designed to act decisively and quickly when it detects a failure. There is no built-in "wait and see if this is transient" window. A 43-second network partition and a permanent data center failure look identical to the Raft consensus algorithm — in both cases, a node is unreachable, quorum exists among the remaining nodes, and a decision can be made. Whether that decision is appropriate depends entirely on the promotion scope configuration.

---

## Split-Brain

Split-brain describes a state where two nodes simultaneously believe they are the authoritative primary for the same data. In a MySQL context, this happens when:

1. A replica is promoted to primary.
2. The original primary is not immediately aware of its demotion (for example, because the network is partitioned).
3. Both nodes continue accepting writes independently.

The result is two *diverged* data sets: writes that exist on one primary but not the other, applied concurrently to the same key space. When connectivity is eventually restored, the system has no automatic mechanism to merge them. MySQL's auto-increment sequences advance independently on both sides, meaning conflicting primary key assignments are possible. Row-level conflicts may exist silently.

Resolving a split-brain at scale requires deciding which side is authoritative and rebuilding the other from scratch. Attempting a merge is possible in theory but requires parsing binary logs, identifying every conflicting write, and resolving each conflict — with no tooling designed for this at production database scale, under incident pressure.

---

## What to Watch For

- **"Replication is working" does not mean "failover is safe."** Replication health and failover guarantees are separate properties. A replica can be perfectly healthy — zero lag, fully caught up — and still be configured in a topology that produces a bad outcome on promotion.

- **The promotion scope is as important as the failover mechanism.** Orchestrator doing the right thing and Orchestrator doing the right thing given the application's constraints are not the same question. Both require separate answers.

- **Latency characteristics can change topology correctness.** A write path that works at 3ms round-trip may not work at 85ms. Application code written against one assumption doesn't automatically tolerate a change in the other direction.

---

## Further Reading

- [GitHub's full post-incident analysis](https://github.blog/news-insights/company-news/oct21-post-incident-analysis/) — Read this **after** completing your analysis, not before. This is the real incident that inspired this exercise. Reading it first collapses the diagnostic work the exercise is designed to build.

- [MySQL semi-synchronous replication](https://dev.mysql.com/doc/refman/8.0/en/replication-semisync.html) — The official reference for how semi-sync replication works, its configuration options, and the fallback behavior when no replica acknowledges within a timeout.
