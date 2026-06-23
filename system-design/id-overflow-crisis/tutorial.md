# PostgreSQL Locking and Zero-Downtime Schema Changes

> Already familiar with PostgreSQL lock modes and concurrent DDL? Skip this and go straight to `README.md`.

---

Schema migrations in PostgreSQL are deceptively dangerous at scale. Many operations that look like simple configuration changes — changing a column type, adding a constraint — can acquire locks that block all reads and writes for extended periods. On a table with 1.8 billion rows, a naive migration command is not a configuration change. It is an outage.

---

## How PostgreSQL Locks Work

PostgreSQL uses lock modes to coordinate concurrent access. For schema changes, the two modes that matter most are:

**ACCESS EXCLUSIVE** — The heaviest lock. Blocks every other operation on the table: reads, writes, and all other DDL. Required by `ALTER TABLE` when it must rewrite rows (type changes, adding non-null columns with non-constant defaults, etc.). Held for the entire duration of the operation.

**SHARE UPDATE EXCLUSIVE** — A lighter lock. Blocks other DDL and autovacuum, but does not block reads or writes. Used by `CREATE INDEX CONCURRENTLY`, `REINDEX INDEX CONCURRENTLY`, and `VALIDATE CONSTRAINT`. Safe to hold for long durations under live traffic.

The critical insight: `ALTER TABLE users ALTER COLUMN id TYPE BIGINT` triggers a full table rewrite. PostgreSQL cannot cast in place because the storage representation of a 32-bit integer differs from a 64-bit integer. It must read every row and write a new heap file. On 1.8 billion rows this takes 20–40 minutes under normal disk I/O. The `ACCESS EXCLUSIVE` lock is held for the entire duration — no reads, no writes. At 90,000 writes per hour, queued connections exhaust the connection pool within seconds. The application stops serving requests before the migration finishes.

---

## The CONCURRENTLY Modifier

Several DDL operations have a `CONCURRENTLY` variant that avoids or reduces locking:

**`CREATE INDEX CONCURRENTLY`** — Builds an index without holding an exclusive lock. Acquires a `SHARE UPDATE EXCLUSIVE` lock and performs multiple passes over the table, reading live data each time. Reads and writes continue during the build. Cannot run inside a transaction block.

**`REINDEX INDEX CONCURRENTLY index_name`** — Rebuilds an existing index using the same non-blocking approach. This matters for the primary key index: after a column type change, the index must be rebuilt. Doing it without `CONCURRENTLY` acquires `ACCESS EXCLUSIVE` and re-introduces the original lock problem through the back door.

**`DROP INDEX CONCURRENTLY`** — Drops an index without blocking reads or writes.

Note: `ALTER TABLE` has no `CONCURRENTLY` variant. That is precisely why zero-downtime type migrations require workarounds rather than a direct column change.

---

## NOT VALID + VALIDATE CONSTRAINT

Adding a foreign key constraint normally requires PostgreSQL to scan the entire referencing table to verify every FK value exists in the referenced table. On a large table, this scan takes minutes and holds an `ACCESS EXCLUSIVE` lock on both tables for the full duration.

PostgreSQL provides a two-step alternative:

```sql
-- Step 1: Add the constraint without validating existing rows
-- Fast, acquires only a brief ACCESS EXCLUSIVE for metadata, does not scan rows
ALTER TABLE sessions
  ADD CONSTRAINT sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id)
  NOT VALID;

-- Step 2: Validate existing rows in a separate transaction
-- Uses SHARE UPDATE EXCLUSIVE only — reads and writes continue
ALTER TABLE sessions VALIDATE CONSTRAINT sessions_user_id_fkey;
```

`NOT VALID` constraints are enforced immediately for new writes but skip validation of existing rows. `VALIDATE CONSTRAINT` runs the validation scan using only a `SHARE UPDATE EXCLUSIVE` lock. For large child tables this is the only safe way to add or rebuild FK constraints under live traffic.

---

## What to Watch For

- **Locks queue, not skip.** Even if your migration eventually releases its `ACCESS EXCLUSIVE` lock, every query that arrived during the lock is queued behind it. At 90,000 writes per hour, the queue grows by 25 writes per second. A 20-minute lock produces 30,000 queued writes. Connection pools typically cap at 100–200 connections; they exhaust in seconds, after which new connections are rejected outright.

- **Sequences are typed independently of columns.** A `SERIAL` column's sequence is a separate database object with its own declared type. Migrating the column to `BIGINT` does not update the sequence. The sequence continues producing 32-bit integer values and will overflow at 2,147,483,647 regardless of what the column type now says.

- **CONCURRENTLY cannot run inside a transaction block.** `CREATE INDEX CONCURRENTLY` and `REINDEX INDEX CONCURRENTLY` fail if issued inside a `BEGIN` / `COMMIT` block. Migration frameworks that wrap all operations in a single transaction will silently fail or fall back to the locking variant if not configured to handle this correctly.

---

## Further Reading

- [PostgreSQL: Table-Level Locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-TABLES) — the canonical reference for which lock mode each command acquires
- [PostgreSQL: ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html) — documents which operations trigger table rewrites and which are metadata-only
