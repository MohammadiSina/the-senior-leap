'use strict';

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
    // The MaxListeners warning was showing up in the logs.
    // Setting this to 0 (unlimited) makes the warning go away.
    this.setMaxListeners(0);
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

// ─── Audit Middleware ─────────────────────────────────────────────────────────

// Logs any store mutations that happen during a request, with request context.
app.use((req, res, next) => {
  store.on('change', (event) => {
    console.log(`[audit] ${req.method} ${req.path} — ${event.type}`);
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
  console.log(`[mem] rss=${mb(m.rss)} heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}`);
}, 15_000).unref();

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Task API listening on http://localhost:${PORT}`);
  console.log('Run `node load.js` in a separate terminal to simulate traffic.');
  console.log('Open chrome://inspect to take heap snapshots.');
});
