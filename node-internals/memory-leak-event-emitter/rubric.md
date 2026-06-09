# Rubric — Memory Leak — Event Emitter

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.

---

## What a Senior Engineer Would Notice

Items are grouped by how much their absence reveals a gap in thinking.

---

### 🔴 Critical

**The middleware registers a new listener on every incoming request — and never removes it.**

`store.on('change', fn)` inside `app.use()` is called once per request. Node.js appends the callback to an internal listener array on the emitter. That array grows by one entry per request, forever. There is no `store.off()`, no `store.removeListener()`, no `once()` — nothing removes these callbacks. After 10,000 requests, there are 10,000 callbacks attached to `store`'s `change` event. They never leave.

This is the root cause. Finding the symptom ("memory grows") without identifying this mechanism isn't a complete diagnosis.

---

**Each listener closure retains the full `req` object, preventing garbage collection.**

The callback passed to `store.on` closes over `req` — it references `req.method` and `req.path`. Because the callback is alive (held by the emitter), the variables it closes over are alive. That means `req` — the entire Express request object, including headers, body, socket reference, and Express's internal request state — cannot be collected as long as the listener exists.

This is a *double accumulation*: not just the callbacks themselves, but a full request context per callback. At real traffic volumes, this is what produces the RSS growth ops sees in production. A senior would explain both what's retained *and why it can't be freed*.

---

### 🟡 Important

**`setMaxListeners(0)` silenced the only built-in warning for this exact pattern.**

Node's `MaxListenersExceededWarning` fires when more than 10 listeners are registered on a single event. It is not a performance concern — it is a diagnostic specifically designed to catch "you called `on()` without a matching `off()`." The code sets it to 0 (unlimited) to make the warning disappear from the logs. The warning was the correct signal. Silencing it instead of investigating it is what allowed the leak to reach production.

A senior reviewing this PR would flag `setMaxListeners(0)` immediately, regardless of whether they'd already found the middleware bug. It's a code smell with a narrow legitimate use (e.g., a library intentionally supporting arbitrary subscriber counts), and this is not that.

---

**The audit log output is a clue hiding in plain sight.**

When a POST fires a `change` event, *every accumulated listener fires* — including all the ones registered by prior GET requests. Under load, a single `POST /tasks` produces dozens or hundreds of audit log lines for `GET /tasks`. A senior monitoring logs would notice that the same event is being logged many times, often with the wrong request context. The noisiest log line is pointing directly at the bug.

---

### 🟢 Bonus

**Two valid fix patterns, with different tradeoffs — knowing both matters.**

*Fix 1: Register once at startup.* If per-request context isn't actually needed in the audit log, register a single listener outside the middleware. One listener, forever stable, no cleanup required. This is the right answer if the audit log's purpose is just to record that a mutation occurred.

*Fix 2: Register per-request and clean up on `res.on('finish')`*. If the original intent (logging which request triggered which mutation) is genuinely valuable, the correct pattern is to capture the listener reference and remove it when the response finishes:

```js
app.use((req, res, next) => {
  const auditListener = (event) => {
    console.log(`[audit] ${req.method} ${req.path} — ${event.type}`);
  };
  store.on('change', auditListener);
  res.on('finish', () => store.off('change', auditListener));
  next();
});
```

`res.on('finish')` fires after the response is sent and is the standard hook for per-request cleanup in Express middleware. A senior can name this pattern, not just gesture at "we should clean it up somehow."

---

**`listenerCount()` as a production diagnostic.**

`emitter.listenerCount('event')` returns the current listener count for an event. On a healthy long-lived emitter, this should be stable — either a small fixed number (one or a few registered-at-startup listeners) or near zero (per-request listeners cleaned up properly). Exposing this as a metric — or even a `/healthz` detail — would have surfaced this leak long before ops noticed the RSS climbing.

---

## Common Mistakes

**Looking at routes instead of middleware.** The routes look clean, so the investigation stalls. The middleware — often treated as boilerplate — is where the registration happens.

**Attributing the growth to task data.** "The `Map` grows as tasks are added" is a natural first guess. It falls apart quickly — the task data is tiny compared to the observed RSS growth, and a simple calculation shows it can't account for the numbers. But people sometimes reach for this explanation and don't push through it.

**Misunderstanding what a heap snapshot comparison shows.** The "Comparison" view surfaces objects by how many *new instances* appeared, not by absolute size. Sorting by `# Delta` rather than `+Size` is what finds the accumulating callbacks — they're small individually, but thousands of them make the delta obvious.

**Treating `setMaxListeners(0)` as normal.** Engineers who've seen this pattern before know it's a red flag. Engineers who haven't may read it as a reasonable config option. It's worth knowing: almost no legitimate use case requires setting it to zero.
