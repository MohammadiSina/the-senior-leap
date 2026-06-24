# Event Sourcing and GDPR Article 17

> Already comfortable with event sourcing and the specifics of GDPR's erasure requirements? Skip this and go straight to `README.md`.

---

Event sourcing is an architectural pattern where application state is derived entirely from a log of events rather than from a current-state store. Instead of updating a row, you append an event.

---

## How Event Sourcing Works

In a conventional database: `ticket.status = "resolved"`. In an event-sourced system: `TicketCreated`, `AgentAssigned`, `MessageAdded`, `TicketResolved`. The current state is a **projection** — a read model built by replaying events in order from the beginning of time, or from the last known snapshot.

Two properties follow from this design that matter for this exercise:

**The event log is append-only by design, not by convention.** New events are written; existing events are never updated or deleted. This immutability is what makes the system trustworthy: if you can edit a past event, you can no longer trust that replaying the log produces a correct and auditable state.

**Read models are disposable; the event log is the truth.** If a projection is corrupted or out of date, you rebuild it by replaying events. Enterprise customers often pay for this replay capability explicitly — it satisfies their own audit and compliance requirements.

---

## What GDPR Article 17 Requires

Article 17 is the "right to erasure." When a data subject requests it, the controller must erase their personal data without undue delay, subject to narrow exceptions (legal obligation to retain for other purposes, public interest, etc.).

The word "erased" is less settled in practice than it sounds. Two interpretations matter:

**Actual deletion:** The data no longer exists in any storage medium accessible to the controller. This is the conservative interpretation and the safe harbor outside counsel typically recommends when the question is unsettled.

**Effective inaccessibility:** The data exists on disk but cannot be read by anyone, including the controller. This is the basis for crypto-shredding. Whether inaccessibility satisfies "erasure" under GDPR has not been definitively resolved by courts or regulators for event-sourced systems. The ICO's published guidance is ambiguous on the point.

---

## The Canonical Solutions

Two approaches are widely used in practice:

**Crypto-shredding:** Personal data in the event store is encrypted with a per-user key. To erase a user, you delete their key. The events remain in the log but are computationally unreadable without the key. This preserves the immutability and structure of the event store while rendering personal data inaccessible.

**Dual-model / PII lookup table:** Personal data is never written to the event stream. Events contain only pseudonymous identifiers (a UUID that maps to the user's real identity). PII — name, email, account details — lives in a separate, mutable relational database. To erase a user, you delete their record from that database. The event stream remains valid because its references are pseudonymous, not identifying.

Both approaches are architecturally sound for systems that were designed or migrated to support them. Understanding why they work is exactly what you need to recognize why they may not apply in a given situation.

---

## What to Watch For

- **Crypto-shredding is a legal bet, not a technical guarantee.** It addresses accessibility, not existence. Whether that satisfies a specific regulator's definition of "erased" is a legal question, not a technical one. Outside counsel sometimes declines to issue written opinions on it, particularly when ICO enforcement practice on the question is thin.

- **The dual-model requires upfront discipline and known PII boundaries.** It only works if personal data was never written to the event stream, or if you can identify exactly where it is in order to extract it. Structured events with known fields can be pseudonymized. Free-text events — where PII may appear at any position in an arbitrary string — cannot be reliably de-identified without either destroying the content or accepting misses.

- **Retrofitting either approach to an existing event store is not the same problem as implementing it from scratch.** An existing store requires re-processing every historical event, which requires understanding where all PII is, which requires that the PII is findable. "Findable" is a much harder condition to satisfy for unstructured content than for structured fields.

---

## Further Reading

- [ICO: Right to Erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/) — the UK regulator's published position; note what it does and does not say about technical erasure mechanisms
- [Event Sourcing Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing?spm=a2ty_o01.29997173.0.0.2e9755fbTxLDVC) — industry-standard documentation for event sourcing, and specifically calls out using crypto-shredding when you can't separate personal data from events.
