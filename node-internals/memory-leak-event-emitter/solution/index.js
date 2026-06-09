'use strict';

// Fixed version of the task API.
//
// The original bug: the audit middleware called store.on('change', fn) on every
// request without ever removing the listener. Each callback closed over `req`,
// so both the callback and the full request object were retained indefinitely.
// store.setMaxListeners(0) silenced the only built-in warning for this pattern.
//
// Two approaches are shown below. Approach 2 is active; Approach 1 is commented
// out. Read both — they have different tradeoffs and the right choice depends on
// whether per-request context in the audit log is genuinely useful.

const express = require('express');
const { EventEmitter } = require('events');

const app = express();
app.use(express.json());

// ─── Task Store ──────────────────────────────────────────────────────────────

class TaskStore extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map();
    this._nextId = 1;
    // Do NOT call setMaxListeners(0).
    //
    // The MaxListeners warning is a diagnostic, not noise. If you're seeing it,
    // something is calling on() without a matching off(). Silence the symptom
    // and you lose your only early warning for this class of leak.
  }

  add(title) {
    const task = {
      id: this._nextId++,
      title,
      done: false,
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    this.emit('change', { type: 'add', task });
    return task;
  }

  complete(id) {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.done = true;
    task.completedAt = new Date().toISOString();
    this.emit('change', { type: 'complete', task });
    return task;
  }

  getAll() {
    return Array.from(this.tasks.values());
  }
}

const store = new TaskStore();

// ─── Approach 1: Register once at startup ────────────────────────────────────
//
// If you don't actually need per-request context (method, path) in the audit
// log, this is the correct pattern: register a single listener at startup.
// One listener, forever stable, zero cleanup required.
//
// The tradeoff: you lose the request context. The log tells you a mutation
// happened but not which request caused it. For many use cases, that's fine —
// the store event already contains the mutation details.
//
// store.on('change', (event) => {
//   console.log(`[audit] ${event.type} at ${new Date().toISOString()}`);
// });

// ─── Approach 2: Register per-request, clean up on res.finish ────────────────
//
// If per-request context is genuinely valuable (e.g., you're correlating audit
// events to specific API calls), register and remove the listener per request.
//
// The key: capture the listener as a named variable so you can pass the exact
// same reference to off(). Calling on() and off() with different function
// instances (e.g., anonymous lambdas) would not work — off() matches by
// reference, not by structure.
//
// res.on('finish') is the right hook: it fires after the response is sent and
// headers are flushed, which is when this request's listener is no longer needed.
//
app.use((req, res, next) => {
  const auditListener = (event) => {
    console.log(`[audit] ${req.method} ${req.path} — ${event.type}`);
  };

  store.on('change', auditListener);

  // Remove the listener when this response finishes.
  // Without this line, the original bug: auditListener lives forever,
  // keeping req alive in its closure.
  res.on('finish', () => {
    store.off('change', auditListener);
  });

  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/tasks', (req, res) => {
  res.json(store.getAll());
});

app.post('/tasks', (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const task = store.add(title);
  res.status(201).json(task);
});

app.patch('/tasks/:id/complete', (req, res) => {
  const task = store.complete(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'task not found' });
  res.json(task);
});

// ─── Memory Reporter ──────────────────────────────────────────────────────────

setInterval(() => {
  const m = process.memoryUsage();
  const mb = (n) => `${Math.round(n / 1024 / 1024)}MB`;
  // With the fix in place, heapUsed and rss should stay flat under load.
  // listenerCount is exposed here as a diagnostic: with Approach 2 it hovers
  // near 0 (cleaned up after each response); with Approach 1 it's exactly 1.
  // In production, this is worth exposing as a metric on any long-lived emitter.
  console.log(
    `[mem] rss=${mb(m.rss)} heap=${mb(m.heapUsed)}/${mb(m.heapTotal)} ` +
    `listeners=${store.listenerCount('change')}`
  );
}, 15_000).unref();

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Task API (fixed) listening on http://localhost:${PORT}`);
  console.log('Run `node load.js` to verify memory is now stable under load.');
});
