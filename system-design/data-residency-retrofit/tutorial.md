# Multi-Region Data Architecture & Data Residency

> Already comfortable with control planes, data planes, and why "replication for speed" and "replication for compliance" are different problems? Skip this and go straight to `README.md`.

---

Most engineers meet multi-region systems through the *latency* lens first: put a copy of the data close to the user, replicate for redundancy, fail over if a region goes down. **Data residency** is a different problem wearing similar clothes. It isn't about making data available in a region — it's about guaranteeing data is *confined* to one. The two goals can point in opposite directions: a system tuned to replicate everywhere for speed is, by construction, bad at promising data never leaves a boundary.

This is closely related to, but not the same as, **data sovereignty** (the legal principle that data is subject to the laws of the country it's stored in) and **data localization** (a regulatory requirement that certain data types must be stored within a country's borders). Residency is usually the engineering-facing commitment that satisfies sovereignty/localization requirements — but the contractual promise ("your data stays in the EU") and the technical guarantee (which systems actually enforce that) are not automatically the same thing. Part of the job is finding the gap between them.

---

## How It Works

**Realms and shards.** A common pattern for building residency into a multi-tenant system: define a **realm** — a geographic boundary, which might be a single region or a small group of them — and record, per tenant, which realm their data belongs in. Individual services that store tenant data are then organized into **shards**: a shard says which region(s) a given service's data for a given tenant actually lives in, plus how to route requests to it. The realm is the promise; the shard is the implementation detail of keeping it, service by service.

**Control plane vs. data plane.** In a multi-region system, it's useful to separate two kinds of traffic:

- **Data plane** — the ordinary business of reading and writing tenant data. High volume, latency-sensitive, doesn't change where anything lives.
- **Control plane** — operations that change *where* data lives: provisioning a new tenant, migrating an existing one between realms, rebalancing shards. Lower volume, but far higher blast radius if it goes wrong.

Keeping these separate matters because a bug in the data plane usually costs you a slow request. A bug in the control plane can leave a tenant's data split across two places at once, migrate the wrong tenant, or silently leave a copy behind.

**Progressive rollout.** In any system with more than a handful of services, don't expect uniform regional capability. Some services will support a new region on day one; others will take months. A production-grade migration plan has to be built assuming that not everything is ready at the same time — not as an edge case, but as the normal state of affairs.

**Safe live migrations, generally.** Moving data between two locations while the system stays up is one of the higher-risk classes of distributed systems work. Two ideas worth having solid before you reason about any specific migration:

- Migrations are usually decomposed into an "add the data to the new location" step and a "remove it from the old location" step — the order and independence of those two steps is where most of the danger lives.
- Anything already in flight — a request, an event on a queue — when the migration happened needs to be handled by *something* checking, at the moment it's actually processed, whether the location it assumed is still correct.

Neither of those is a fix by itself — they're the vocabulary for reasoning about the specific failure modes you'll need to find in the exercise.

---

## What to Watch For

- "Residency" as a word can quietly expand or contract depending on who's using it — a salesperson, a lawyer, and an engineer can mean three different scopes of "data" without realizing they disagree.
- A service being deployed *in* the target region is not the same claim as a tenant's data for that service being *only* in the target region. Read regional deployment and regional confinement as two separate facts.
- Central, shared infrastructure (identity, auth, routing metadata) often has good reasons to stay global — that's not automatically a bug, but it is something that has to be stated, not assumed away.

---

## Further Reading

> ⚠️ **Spoiler warning.** The link below is Atlassian's own engineering write-up of how they actually built this system — including how they solved the exact migration-ordering and in-flight-event problems this exercise asks you to reason through. Reading it before you've written `my-analysis.md` will hand you the answer instead of letting you find it. Come back to it after.

- [How we build Data Residency for Atlassian Cloud](https://www.atlassian.com/blog/atlassian-engineering/how-we-build-data-residency-for-atlassian-cloud) — the real architecture this exercise is drawn from: realms, shards, the Cloud Provisioner control plane, and the specific migration challenges Atlassian's engineers hit building it.
