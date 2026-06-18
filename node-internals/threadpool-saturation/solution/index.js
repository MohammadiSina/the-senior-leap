'use strict';

// Solution: isolate password hashing into a dedicated worker_threads pool.
//
// The bug was never in any single route — it was that crypto.pbkdf2() and
// fs.readFile() both draw from the same libuv thread pool (default: 4
// threads), so heavy login traffic starved out completely unrelated avatar
// reads, and vice versa.
//
// The fix below doesn't touch the avatar route at all. It moves hashing
// onto its own dedicated threads, which frees up libuv's shared pool for
// fs (and anything else that needs it) without any change to that code —
// it was never the problem, it was only ever sharing a resource with one.
//
// Mitigations worth knowing, NOT applied here as the primary fix:
// - Raising UV_THREADPOOL_SIZE (env var, set before the process starts):
//   buys headroom but doesn't decouple the two features, and has limits —
//   each extra thread costs memory/scheduling overhead, and CPU-bound work
//   like pbkdf2 gets no benefit past your physical core count.
// - Rate-limiting /login: worth doing anyway given the credential-stuffing
//   framing, but it's a separate problem. Fewer requests still collide
//   with avatar traffic if there are enough of them.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { AVATAR_DIR, AVATAR_COUNT } = require('../app/avatars');

const app = express();
app.use(express.json());

// ─── Password Hashing — Dedicated Worker Pool ────────────────────────────────

const PBKDF2_ITERATIONS = 150_000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';

const STORED_SALT = crypto.randomBytes(16);
const STORED_HASH = crypto
  .pbkdf2Sync('correct-password', STORED_SALT, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
  .toString('hex');

// Sized for this workload specifically, independent of UV_THREADPOOL_SIZE
// (which stays at its default 4, shared by fs/dns/zlib and whatever else
// needs it). In a real service, this number comes from load testing the
// hashing workload in isolation — not a guess copied from an example.
const POOL_SIZE = 2;

const workers = [];
const pending = new Map();
let nextWorker = 0;
let taskCounter = 0;

for (let i = 0; i < POOL_SIZE; i++) {
  const worker = new Worker(path.join(__dirname, 'hash-worker.js'));

  worker.on('message', (msg) => {
    const task = pending.get(msg.taskId);
    if (!task) return;
    pending.delete(msg.taskId);
    if (msg.error) task.reject(new Error(msg.error));
    else task.resolve(msg.hash);
  });

  worker.on('error', (err) => {
    // In production: restart the worker and reject any tasks it was
    // holding, the same way event-loop-starvation's solution does.
    console.error(`[hash-worker ${i}] error:`, err.message);
  });

  workers.push(worker);
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const taskId = ++taskCounter;
    pending.set(taskId, { resolve, reject });

    // Simple round-robin. A real pool under variable load would want a
    // work queue instead, so a slow task on one worker doesn't strand
    // requests that got routed to it — out of scope for this exercise.
    const worker = workers[nextWorker];
    nextWorker = (nextWorker + 1) % workers.length;

    worker.postMessage({
      taskId,
      password,
      salt: STORED_SALT.toString('hex'),
      iterations: PBKDF2_ITERATIONS,
      keylen: PBKDF2_KEYLEN,
      digest: PBKDF2_DIGEST,
    });
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// LOGIN — now dispatches to the dedicated worker pool above instead of
// libuv's shared thread pool. The route's external behavior is unchanged.
app.post('/login', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password is required' });

  try {
    const hash = await hashPassword(password);
    res.json({ authenticated: hash === STORED_HASH });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AVATAR — identical to the broken version. This code never changed,
// because it was never the bug — it just shared a pool with one.
app.get('/avatar/:id', (req, res) => {
  const id = Math.max(1, Math.min(AVATAR_COUNT, Number(req.params.id) || 1));
  const filePath = path.join(AVATAR_DIR, `${id}.bin`);

  fs.readFile(filePath, (err, data) => {
    if (err) return res.status(404).json({ error: 'avatar not found' });
    res.json({ id, bytes: data.length, sample: data.subarray(0, 8).toString('hex') });
  });
});

app.get('/weather', (req, res) => {
  setTimeout(() => {
    res.json({ city: 'Berlin', tempC: 14, condition: 'Cloudy' });
  }, 300 + Math.random() * 500);
});

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Auth & Profile API (worker pool fix) listening on port ${PORT}`);
  console.log(`Hashing runs on a dedicated ${POOL_SIZE}-worker pool — libuv's shared`);
  console.log('thread pool is now free for fs/dns/zlib regardless of login volume.');
});
