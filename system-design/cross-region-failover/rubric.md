# Rubric — Cross-Region Failover

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.
>
> This file also serves as the reference solution — see the Reference Reasoning section at the end.

---

## What a Senior Engineer Would Notice

---

### 🔴 Critical

**Orchestrator's behavior was correct. The configuration was wrong. The team had never verified that the application tier could tolerate every topology Orchestrator was allowed to create.**

The Raft quorum of West Coast + public cloud nodes correctly detected an unreachable East Coast primary and promoted West Coast replicas — exactly as configured. Orchestrator did not malfunction. The gap was that nobody had asked: "What topologies can Orchestrator create, and can our application tier actually tolerate all of them?" Orchestrator's promotion scope included cross-region candidates. The application tier had never been tested writing cross-country. At 22:52:44 UTC, application servers running in the East Coast began issuing database writes to primaries 3,000 miles away at 85ms round-trip — a write latency they had never been tested against. Application services with timeouts calibrated to sub-10ms same-region writes began failing. The error rate at 22:52:44 was only 2.4%; by 23:13 it was 41.3%. That 21-minute escalation was not caused by the database becoming less available — the database was up and accepting writes the entire time. It was caused by services with implicit write-latency assumptions encountering a topology that violated them, one timeout cascade at a time.

The senior question — "can our application tolerate every topology the failover tool is allowed to create?" — is not a monitoring question. It cannot be answered by looking at replication health. It requires reading Orchestrator's promotion scope configuration and comparing it against the latency assumptions baked into every application service. That work had not been done.

---

**Asynchronous replication plus automated failover means write loss is guaranteed on any partition. The recovery path is determined by whether diverged clusters can be merged — and at this scale, they cannot.**

With async replication, the primary commits a write and confirms it to the application before any replica acknowledges receipt. During the 43-second partition, the East Coast primary accepted writes that were never streamed to West Coast replicas. When connectivity restored, the East Coast held writes that existed nowhere else. The West Coast primaries — now authoritative — had no knowledge of those writes. This is not an accident of this specific incident: it is the guaranteed behavior of async replication plus failover. Every time a replica is promoted during a partition window, that promotion erases the writes the original primary accepted but did not replicate.

What made this a 24-hour incident rather than a fast recovery was the merge problem. MySQL has no built-in mechanism for reconciling diverged clusters. Auto-increment sequences on East and West had advanced independently — primary key collisions are possible. Binary log replay could identify individual writes, but comparing them across twelve clusters, under incident pressure, with no tooling designed for this purpose, at production database scale, introduces unacceptable risk of silent data corruption. The engineering team correctly concluded that the only clean path was to declare the West Coast authoritative — absorbing the loss of the partition-window East Coast writes — and rebuild East Coast from a West Coast backup. That decision was right. But it was forced by a replication mode whose failover consequences had not been explicitly acknowledged. The system was designed for availability; the cost to data integrity on failover had never been written down.

---

### 🟡 Important

**Nobody had measured how long it takes to rebuild all twelve MySQL clusters from cold cloud backup. The answer — 24 hours — was discovered during the incident, not before it.**

The decision at 23:20 UTC to rebuild East Coast from cloud backup was operationally correct given the constraints. But when the incident coordinator asked "how long will this take?", the answer was "hours" — not a number derived from a tested procedure. The twelve cluster backups were stored in cloud object storage, which is a sound durability choice. The missing piece was that nobody had run the full restore path end-to-end and timed it. This meant incident responders were navigating without a recovery time estimate for their most consequential decision. It also meant nobody could trade off "attempt a partial merge on the most-critical clusters, cold restore the rest" against "cold restore everything" in a principled way, because the timing data to make that comparison didn't exist.

The correct number to have before the next incident is: given a full loss of all twelve clusters requiring rebuild from cold cloud backup, what is the end-to-end time per cluster and in parallel? That number shapes runbook decisions, shapes customer communication timelines, and shapes the engineering priority of reducing backup restoration time. Running a restoration drill in a non-production environment and measuring it is not heroic work. It is the operational hygiene that makes the next incident a known quantity.

---

**Option A — constraining Orchestrator's promotion scope to within-region — is the only mitigation that can be shipped without a production measurement plan. Picking B or C first solves a harder problem than the one that just happened.**

Semi-synchronous replication (Option B) changes the latency characteristic of every database write in the system. At GitHub's write volume, the primary must now wait for at least one replica to acknowledge before confirming. In a same-data-center configuration, this round-trip is negligible. In a geographically distributed configuration — which is the relevant context here — this adds meaningful write latency that must be measured under production traffic before the change is safe to ship. Getting this wrong means trading one incident for a different one. Human-gated failover (Option C) extends MTTR for every primary failure, including within-region ones that previously recovered automatically in seconds. Disabling automation from the failover path is not a targeted fix; it is a blanket reduction in recovery speed.

Option A is surgical. It addresses exactly the failure mode that just happened — cross-region promotion — without touching same-region failover automation or write latency characteristics. It can be validated in a staging environment within hours. The cost is explicit: cross-region failover now requires a human decision. That is an accepted operational tradeoff, not an unknown risk. A senior who picks B or C first, under the time pressure of an incident post-mortem, is choosing a change with unmeasured production impact over a change with a well-understood, bounded cost.

---

### 🟢 Bonus

**The three-node Raft quorum makes "transient partition" and "permanent data center failure" indistinguishable. This is a design tradeoff, not a bug — but it is worth naming as a forward-looking concern.**

Raft consensus is designed to act decisively when a quorum of nodes agrees a peer is unreachable. There is no built-in concept of "wait and see if the partition is transient before promoting." With three nodes (East, West, Cloud), losing East means the other two have quorum and will act. A 43-second maintenance window and a real data center failure both look identical to the consensus algorithm — a node is not responding, quorum exists, a decision can be made. Orchestrator performed correctly within this model.

A senior who notices this frames it as a design tradeoff: the same quorum design that makes failover fast and reliable also makes it impossible to distinguish a temporary blip from a genuine failure. The mitigation in Option A (human gate for cross-region promotions) addresses the consequence; a deeper architectural question is whether cross-region failover decisions should have a configurable "wait before acting" window — a delay that allows transient partitions to self-heal before automation takes an irreversible step. This observation doesn't change the immediate priority order. But it surfaces a category of system design question — automation that distinguishes transient from sustained failures — that will arise again.

---

## Common Mistakes

**"Switch to synchronous replication."** Full synchronous replication requires the primary to wait for *all* replicas to acknowledge before confirming a write. Across geographically distributed data centers, this adds cross-country round-trip latency — roughly 85ms — to every committed write in steady state. At GitHub's write volume, this would fundamentally alter the platform's performance characteristics. This conflates two separate goals: "we want better durability guarantees during failover" and "we need every write to be immediately consistent everywhere." Semi-synchronous replication — wait for *one* replica, not all — achieves the first goal without the same penalty. Even semi-sync requires careful measurement at production write volume before a safe rollout. The instinct to reach for maximum consistency is correct in direction; the specific proposal is not calibrated to the operational context.

**"Disable automated failover."** This swaps one risk for another. Automated failover exists because manual primary promotion under incident pressure is slow, error-prone, and requires an on-call engineer in the critical path for every failure. Removing it entirely means every same-region primary failure — a routine event at GitHub's scale — now waits for human intervention. The problem with this incident was not that Orchestrator acted; it was that Orchestrator's configured action produced a topology the application couldn't tolerate. The correct fix is constraining what the automation is allowed to do, not whether it acts.

**"The solution was better monitoring / faster human response."** Engineers knew the topology was wrong by 23:02 UTC — 10 minutes after the partition ended. The problem was not detection speed. It was that the automated system had already created a state (diverged clusters, West as primary, ongoing write traffic) with no fast recovery path. Better monitoring would not shorten a cold backup restoration that takes 24 hours. The gap was architectural — in the failover configuration and the replication mode — not observational.

**"Roll back the West Coast writes and restore East Coast as primary."** This sounds procedurally clean but misunderstands the timeline. The decision point was 23:20 UTC — 28 minutes after the partition ended. During those 28 minutes, production traffic had continued writing to West Coast primaries. A rollback to the pre-failover state would abandon every write since 22:52:43, affecting a much larger set of users than the 43-second partition window. The engineering team correctly chose to accept the West Coast state as authoritative and rebuild East Coast to match — not because rollback was impossible, but because the data at risk had grown past the point where rollback was the smaller cost.

---

## Reference Reasoning

> This is not the correct answer. It is the reasoning a senior engineer would likely apply and the design they would land on. A defensible answer that reaches different conclusions through sound reasoning is equally valid.

**Questions a senior asks before the post-mortem:**

- What topologies can Orchestrator create, and have we verified that our application tier can tolerate every one of them? Have we ever tested write behavior under cross-region database latency?
- What does our replication mode guarantee on failover? What exactly is lost — under what conditions, for how many seconds — and has the organization explicitly accepted that as a known cost?
- Have we ever run the full cluster restoration procedure from cold cloud backup and timed it? What is our actual MTTR for this specific failure mode?
- What is the failure mode we were protecting against with automated cross-region failover — and is that failure mode worse than the one we just experienced?

**What they would likely propose:**

*Immediate (ship within days):* Configure Orchestrator to restrict automated promotions to within the same region. Same-region failover continues automated and fast. Cross-region promotions require explicit on-call approval. This is a configuration change. It can be validated in a staging environment within hours, deployed without touching running traffic, and confirmed correct before any real failure requires it. The cost is fully explicit: if the East Coast data center has a sustained failure, cross-region recovery now requires a human in the loop. That is the accepted tradeoff. It is better than the alternative, which was just demonstrated.

*Within weeks:* Run a full cluster restoration drill in a non-production environment. Time it. Document the result. Incorporate the number into incident response runbooks and customer communication SLAs. If the restoration time is reducible — larger cloud instance for restore, parallelized cluster recovery, pre-warmed replica strategy — quantify the effort and make the investment decision with real data.

*Over months, with capacity planning:* Evaluate semi-synchronous replication for the clusters where write durability matters most. Measure the write latency impact at production traffic volume before committing to a rollout. The benefit — a replica always holds every committed write, making cross-region failover loss-free for those clusters — is real. So is the cost. Both need to be understood before the change is shipped.

**What they would explicitly not do, and why:**

- *Move to full synchronous replication immediately* — not wrong in principle but wrong in execution. The failure here was topology scope, not replication mode. Constraining Orchestrator's promotion scope alone prevents recurrence of this specific incident. Full synchronous replication is a significantly larger change with significant steady-state performance impact that requires its own deliberate rollout plan.

- *Attempt to merge the diverged clusters* — at 23:20 UTC, with 28 minutes of post-failover production traffic on the West Coast primaries, a merge attempt requires identifying and resolving every write conflict across twelve clusters, in binary log format, with no purpose-built tooling, under incident pressure. The risk of silently corrupting data during a manual merge is higher than the acknowledged cost of losing 43 seconds of East Coast writes. Cold rebuild is slow and correct. Manual merge is fast and unreliable.

- *Remove automated failover entirely* — this trades one failure mode for another. Every same-region primary failure now requires a human engineer in the critical path. At GitHub's scale, same-region primary failures are not rare events. The correct change is surgical: constrain what the automation is allowed to do, not whether it acts.

**What risks remain:**

- *Cross-region failover now requires human approval.* If the East Coast data center has a genuine sustained failure — not a 43-second partition but a real outage — recovery is slower. An on-call engineer must evaluate the situation and approve a cross-region promotion. This is the explicit cost of Mitigation A, and it is acceptable: a managed, human-supervised cross-region failover is preferable to an unmanaged automated promotion into a topology the application cannot support.

- *Within-region partitions can still produce write divergence.* Mitigation A constrains promotion scope to within-region. It does not change the replication mode. A partition between the East Coast primary and its within-region replicas, followed by a within-region promotion, still risks losing the writes accepted during the partition window — the window is now bounded by within-region replication lag (typically milliseconds), not cross-country partition duration. This risk remains until semi-synchronous replication is shipped.

- *Cold backup restoration MTTR is still unknown.* Until the restoration drill is complete and timed, incident response for this failure mode is navigating without a map. Every decision made in a future incident of this type will be made without knowing how long the recovery path takes.
