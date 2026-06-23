# Rubric — id-overflow-crisis

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.
>
> This file also serves as the reference solution — see the Reference Reasoning section at the end.

---

## What a Senior Engineer Would Notice

---

### 🔴 Critical

**`ALTER TABLE users ALTER COLUMN id TYPE BIGINT` triggers a 20–40 minute table-wide outage, not a migration.**
PostgreSQL cannot change a column's storage type in place. The engine must rewrite every row in the heap to a new heap file with the new type encoding — all 1.8 billion of them. This rewrite holds an `ACCESS EXCLUSIVE` lock for its entire duration, blocking every read and write on the table. At 90,000 writes per hour — 25 per second — the connection pool exhausts within seconds of the lock being acquired. New connections are rejected once the pool saturates. An engineer who runs this command in a migration file has not solved the overflow problem; they have scheduled an outage that is longer than the write queue can absorb and indistinguishable from the maintenance window the team already ruled out.

**Before designing any migration, a senior asks whether BIGINT is even the right destination.**
The 14-week window is not a comfortable margin for a shadow-column BIGINT migration on a 1.8-billion-row table with six child tables — some of which are larger than the parent. A senior pauses before proposing any design to ask: should we migrate in-place to BIGINT, or should we cut over to a surrogate key strategy (UUIDs, Snowflake IDs)? These are not equivalent approaches. BIGINT migration preserves existing IDs and foreign key semantics but requires a multi-week dual-write window and careful child table sequencing. A surrogate key strategy requires application-layer changes but produces a clean key schema and potentially simpler cutover mechanics — and removes the problem permanently rather than raising the ceiling by 4 billion. The answer to this question changes the entire design. A learner who jumps to "migrate to BIGINT" without naming the alternative has made a major architectural decision without examining it.

---

### 🟡 Important

**Foreign key constraints on six child tables must be migrated in a specific order, or the migration produces a schema the application cannot write to.**
The naive migration order — add `id_bigint` to `users`, backfill, cut over — fails the moment FK constraints are in play. A FK constraint on `sessions.user_id` referencing `users.id` breaks when `users.id` changes type, because the constraint references the old column definition. The correct sequence is: (1) add a shadow BIGINT column to each child table, (2) drop the existing FK constraint, (3) migrate the child column to BIGINT, (4) re-add the FK with `NOT VALID` — fast, no validation scan, lightweight lock — (5) run `VALIDATE CONSTRAINT` in a separate transaction, which uses `SHARE UPDATE EXCLUSIVE` instead of `ACCESS EXCLUSIVE` and allows reads and writes to continue. Missing this sequence produces one of two failures: the FK constraint prevents the parent column change outright, or the constraint revalidation takes a full table lock on the child — and `notifications` at 4.3 billion rows is itself a multi-hour lock event under a naive approach.

**The sequence backing `users.id` must be explicitly updated to BIGINT — migrating the column type alone does not fix the overflow.**
PostgreSQL's `SERIAL` type creates a sequence object typed independently of the column it serves. `users_id_seq` has declared type `integer` with a maximum value of 2,147,483,647. After migrating `users.id` to BIGINT, if `users_id_seq` is not updated with `ALTER SEQUENCE users_id_seq AS BIGINT`, the sequence continues producing 32-bit integer values and overflows at exactly the same threshold. The migration appears complete — the column type reads BIGINT — but the first insert after the sequence reaches 2,147,483,647 fails with the same error as before. The sequence update is a one-line operation, and it is the most commonly missed step in INT-to-BIGINT migrations precisely because the column type change feels like the complete solution.

---

### 🟢 Bonus

**The cutover transaction must use a pre-built index, or the migration reintroduces an outage-length lock at the final step.**
When the time comes to promote `id_bigint` to primary key, `ALTER TABLE users ADD PRIMARY KEY (id_bigint)` without a pre-existing unique index triggers a full index build under `ACCESS EXCLUSIVE` on 1.8 billion rows — identical in duration and impact to the original `ALTER TABLE ... TYPE BIGINT` problem. The correct approach is to run `CREATE UNIQUE INDEX CONCURRENTLY users_id_bigint_idx ON users(id_bigint)` before the cutover, which acquires no exclusive lock, and then promote that index inside the cutover transaction with `ADD CONSTRAINT users_pkey PRIMARY KEY USING INDEX users_id_bigint_idx`. An engineer who correctly designs the shadow column and backfill phases, but reaches for `ADD PRIMARY KEY (id_bigint)` in the cutover transaction without a pre-built index, reproduces an outage-length lock at the last step of an otherwise zero-downtime migration.

---

## Common Mistakes

- **Treating `ALTER TABLE users ALTER COLUMN id TYPE BIGINT` as the migration plan.** It feels like the right tool — PostgreSQL has DDL, DDL changes types, this is a type change. What makes it wrong is not the command itself but that it conflates "update the schema definition" with "rewrite 1.8 billion rows under a table-wide exclusive lock." Engineers who have not shipped a migration on a table this large have no prior experience signaling that they should ask what lock the command acquires. The rubric's job is to make them ask that question for every schema change on a large table going forward.

- **Planning the parent migration without auditing the child tables first.** The FK graph is given explicitly in the README. Learners who focus on `users` without working through the child table migration sequence will produce a plan that fails on first contact with FK constraints. The `notifications` table at 4.3 billion rows is itself a migration project — it is larger than the parent table — and its migration timeline may dominate the overall schedule.

- **Forgetting the sequence after correctly planning the column migration.** The sequence's current type is called out explicitly in the README precisely because it is the most commonly missed step. Learners who catch the lock problem and correctly design a shadow-column approach, but do not update `users_id_seq`, have planned a migration that reproduces the original failure on a different database object rather than on the column itself.

---

## Reference Reasoning

> This is not the correct answer. It is the reasoning a senior engineer would likely apply and the design they would land on. A defensible answer that reaches different conclusions through sound reasoning is equally valid.

**Questions a senior asks before designing anything:**

- Is BIGINT the right destination, or should we use a surrogate key (UUID v7, Snowflake ID)? BIGINT migration is lower friction for the existing application but higher complexity for the migration itself. Surrogate keys require more application-layer changes but eliminate the problem class permanently rather than raising the ceiling.
- Which child tables are large enough to be their own migration bottleneck, and can they be migrated in parallel with the parent or only after it? `notifications` at 4.3B rows may take longer to backfill than `users` itself — it should be identified as a first-class constraint on the timeline, not an afterthought.
- What is the maximum replication lag the system can tolerate during the migration window? Shadow column backfills produce write amplification (each insert writes to two columns), which can cause read replicas to lag during the backfill phase.
- Are there long-running transactions on `users` that could block even `SHARE UPDATE EXCLUSIVE` operations? A transaction open for 10 minutes can delay a `VALIDATE CONSTRAINT` indefinitely — application transaction timeout policies need to be verified before the cutover phase begins.
- What is the rollback trigger, and what does rollback look like at each phase? A migration with no defined rollback point at each step has a hidden maintenance window embedded in it.

**What they would likely propose:**

The shadow column approach, executed in phases:

1. **Add `id_bigint BIGINT` to `users`.** In PostgreSQL 11+, adding a nullable column is a metadata-only change — no table rewrite, no lock beyond a brief `ACCESS EXCLUSIVE` for the metadata update. The column starts null for existing rows.

2. **Backfill in bounded batches.** Set `id_bigint = id` for existing rows in batches of 10,000–50,000 rows with a `pg_sleep` between batches to throttle write amplification. At 1.8B rows this takes days at conservative batch rates — that is acceptable given a 14-week window. Monitor replica lag during backfill; slow down if lag exceeds acceptable thresholds.

3. **Enable dual-write at the application layer.** Deploy code that writes to both `id` and `id_bigint` on all new inserts, behind a feature flag. The flag must be active before the backfill completes to avoid a consistency gap on recently inserted rows.

4. **Migrate child tables in parallel where sequencing allows.** Add shadow BIGINT FK columns to each child table, backfill from the existing INT columns, drop the old FK constraint, add the new FK with `NOT VALID`, then `VALIDATE CONSTRAINT` in a separate transaction. Order by size ascending — `referrals`, `orders`, `sessions`, `user_preferences`, `audit_log`, `notifications` — so the longest-running backfills finish last and have the most lead time.

5. **Verify consistency and pre-build the index.** Run a reconciliation query confirming `id = id_bigint` for all rows in `users` and spot-check FK consistency across child tables. Do not proceed if the reconciliation shows gaps. Once verified, run `CREATE UNIQUE INDEX CONCURRENTLY users_id_bigint_idx ON users(id_bigint)`. This acquires no exclusive lock and can complete under live traffic. The index must exist before the cutover transaction begins — promoting an existing unique index to a primary key is a metadata operation; building the index inside a cutover transaction is not.

6. **Atomic cutover.** In a single transaction: drop the old `id` primary key constraint, then promote `id_bigint` to primary key using the pre-built index (`ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY USING INDEX users_id_bigint_idx`). Because the index already exists, this is a pure metadata operation — milliseconds, not minutes. Update FK constraints on child tables to reference the new PK in the same transaction.

7. **Update the sequence.** `ALTER SEQUENCE users_id_seq AS BIGINT` — this resets the maximum to 9,223,372,036,854,775,807. Run this immediately before or inside the cutover transaction.

8. **Validate child table indexes.** The `users_pkey` index was built concurrently in step 5 and promoted in step 6 — no rebuild is needed for the parent. Verify that `VALIDATE CONSTRAINT` has completed for all child tables. For any child table index that needs rebuilding after its FK column migration, use `REINDEX INDEX CONCURRENTLY` — the non-concurrent form acquires `ACCESS EXCLUSIVE` on the child table and reintroduces the same lock problem on a different table.

9. **Drop old columns.** After a validation period with no issues, drop `id` from `users` and the old INT FK columns from child tables.

**What they would explicitly not do, and why:**

- `ALTER TABLE users ALTER COLUMN id TYPE BIGINT` directly — triggers a full table rewrite under `ACCESS EXCLUSIVE` for 20–40 minutes on 1.8B rows. This is a longer outage than a maintenance window and achieves the same result the team already refused to accept.
- Validate FK constraints in the same transaction as the `ADD CONSTRAINT NOT VALID` — the `NOT VALID` pattern exists precisely to split these into two steps with different lock modes. Combining them produces the same locking behavior as a naive `ADD CONSTRAINT` with a full validation scan.
- Treat `notifications` at 4.3B rows as equivalent in effort to `sessions` at 500M rows — the largest child table likely dictates the migration timeline more than the parent table does. Planning without that calculation is planning without the dominant constraint.
- Switch to random UUIDs (UUID v4) as the primary key type without calculating the write-throughput impact. A UUID is 16 bytes vs 8 for BIGINT; at 4.3B notifications rows, the FK index alone grows by roughly 34GB. The more serious problem is B-tree fragmentation: UUID v4 inserts land at random positions in the index, causing page splits and cache thrashing that degrade write throughput at scale. Time-ordered alternatives (UUID v7, Snowflake IDs) eliminate the fragmentation penalty but still carry the 2× storage cost over BIGINT. At this table size and write rate, BIGINT is the correct key type even if the migration to get there is harder.

**What risks remain:**

- **Dual-write consistency gap.** During the backfill and dual-write phase, a write that succeeds on `id` but fails mid-transaction before writing `id_bigint` — due to a crash, timeout, or application-level rollback — produces a row where `id` is set and `id_bigint` is null. This is acceptable because: (a) the old `id` column remains the authoritative source until the cutover transaction commits, and (b) the reconciliation query before cutover detects and surfaces all such gaps so they can be backfilled before proceeding.
- **Replica lag during backfill.** Sustained write amplification from backfilling 1.8B users rows plus 4.3B notifications rows can cause read replicas to lag during peak backfill periods. Read traffic routed to lagging replicas may see stale state. Acceptable if the backfill is throttled with an automatic slowdown trigger on replica lag, and if the product SLA for read consistency is compatible with eventual consistency during this window.
- **Long-running transactions blocking VALIDATE CONSTRAINT.** Batch jobs or application logic that holds transactions open on `users` or child tables can delay `VALIDATE CONSTRAINT` indefinitely. Acceptable only if application-level transaction timeout policies are audited and enforced before the cutover phase begins — this is a prerequisite, not a risk to accept.
