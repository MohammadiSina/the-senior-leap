# Idempotency in Message Queues

> Already comfortable with at-least-once delivery and idempotency keys? Skip this and go straight to `README.md`.

---

An operation is idempotent if running it multiple times produces the same result as running it once. Deleting a file is idempotent — deleting it twice leaves you with the same outcome. Sending an email is not — sending it twice means the recipient gets two emails.

This distinction matters because message queues almost universally guarantee **at-least-once delivery**, not exactly-once. A message will be delivered, but may be delivered more than once. When a consumer crashes after processing a message but before acknowledging it, the queue has no way to know the work was done — so it re-delivers. This is by design. It makes queues reliable. It also means your consumer needs to handle duplicates.

---

## How It Works

The standard queue contract:

1. Consumer dequeues a message
2. Consumer processes it (calls an API, writes to a database, sends an email)
3. Consumer acknowledges the message (removes it from the queue)

If the consumer crashes between steps 2 and 3, the queue re-delivers the message to the next available consumer. That consumer has no way to know that step 2 already happened. It will do step 2 again.

The solution is to make step 2 safe to repeat — which means two things:

**At the application layer:** check before acting. Before sending an email, check a delivery tracking table. If a record exists for `(campaign_id, recipient_id)`, skip it.

**At the provider layer:** pass an idempotency key. Most email APIs (SES, SendGrid, Mailgun) accept a deduplication ID parameter. If a request with the same ID arrives twice, the provider sends the email once and returns success for both requests. This is the cleaner solution — it shifts deduplication to the party best positioned to enforce it.

The idempotency key should be stable across retries and unique per logical operation: `{campaign_id}:{recipient_id}` works well. `{campaign_id}:{recipient_id}:{timestamp}` does not — a new timestamp on retry defeats the purpose.

---

## What to Watch For

- **Queue-level vs. downstream idempotency are different problems.** Making your consumer safe to call twice (checking before writing) is not the same as making your downstream calls idempotent. If your consumer calls an external API, that API needs its own deduplication mechanism. An application-layer check only prevents duplicate sends if the check and the send are atomic — which they usually aren't.

- **Checkpoint granularity determines blast radius.** If you process messages in batches of 500 and checkpoint at the batch level, a crash anywhere in the batch re-processes all 500 messages. If you checkpoint per-message (or use a smaller batch size), a crash re-processes fewer. The right batch size is a tradeoff between throughput efficiency and duplicate exposure per crash.

- **Not all providers support idempotency keys.** Most major email providers do. If yours doesn't, you need to build deduplication in your tracking table — but this only works if the check and the send happen atomically or you accept a small duplicate window.

---

## Further Reading

- [Designing Data-Intensive Applications](https://dataintensive.net/) (Kleppmann), Chapter 11 — the definitive treatment of exactly-once semantics and why they're harder than they sound
- [Amazon SES idempotency](https://docs.aws.amazon.com/ses/latest/dg/send-email-api-idempotency.html) — a concrete example of how a major provider implements dedup IDs
