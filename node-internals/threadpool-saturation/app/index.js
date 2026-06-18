'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AVATAR_DIR, AVATAR_COUNT } = require('./avatars');

const app = express();
app.use(express.json());

// ─── Password Hashing Setup ──────────────────────────────────────────────────

// Iteration count tuned so a single hash takes roughly 100-200ms on typical
// hardware — the same ballpark as real PBKDF2/bcrypt/scrypt usage in
// production auth services. (OWASP's current PBKDF2-SHA256 guidance runs
// well into six figures of iterations; using that here would only make the
// exercise slower to run, not change the mechanism being taught.)
const PBKDF2_ITERATIONS = 150_000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';

// One "registered user," hashed once at startup with the sync variant.
// pbkdf2Sync is fine here — it isn't on a request path, it runs exactly once.
const STORED_SALT = crypto.randomBytes(16);
const STORED_HASH = crypto
  .pbkdf2Sync('correct-password', STORED_SALT, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
  .toString('hex');

// ─── Rough In-Flight Counters ────────────────────────────────────────────────
// Not a measurement of real OS thread occupancy — just a count of how many
// calls this app has dispatched and is still waiting on. Unlike pg.Pool,
// libuv exposes no idleCount/waitingCount equivalent in plain JavaScript.

let pbkdf2InFlight = 0;
let fsInFlight = 0;

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// LOGIN — verifies a password against the stored hash.
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password is required' });

  const start = Date.now();
  pbkdf2InFlight++;

  crypto.pbkdf2(
    password,
    STORED_SALT,
    PBKDF2_ITERATIONS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST,
    (err, derivedKey) => {
      pbkdf2InFlight--;
      const elapsed = Date.now() - start;
      if (elapsed > 250) {
        console.log(
          `[login] hash took ${elapsed}ms (expected ~100-200ms — likely queued behind other thread pool work)`,
        );
      }

      if (err) return res.status(500).json({ error: err.message });
      res.json({ authenticated: derivedKey.toString('hex') === STORED_HASH });
    },
  );
});

// AVATAR — serves a profile photo from disk.
app.get('/avatar/:id', (req, res) => {
  const id = Math.max(1, Math.min(AVATAR_COUNT, Number(req.params.id) || 1));
  const filePath = path.join(AVATAR_DIR, `${id}.bin`);

  const start = Date.now();
  fsInFlight++;

  fs.readFile(filePath, (err, data) => {
    fsInFlight--;
    const elapsed = Date.now() - start;
    if (elapsed > 50) {
      console.log(
        `[avatar] read took ${elapsed}ms (expected a few ms — likely queued behind other thread pool work)`,
      );
    }

    if (err) return res.status(404).json({ error: 'avatar not found' });
    res.json({ id, bytes: data.length, sample: data.subarray(0, 8).toString('hex') });
  });
});

// WEATHER — simulates an external API call over the network.
app.get('/weather', (req, res) => {
  setTimeout(
    () => {
      res.json({ city: 'Berlin', tempC: 14, condition: 'Cloudy' });
    },
    300 + Math.random() * 500,
  );
});

// DEBUG — app-tracked dispatch counts. Not a real thread pool depth metric,
// just what this process knows about its own outstanding calls. There is no
// library-level equivalent of pg.Pool's idleCount/waitingCount for this.
app.get('/debug/inflight', (req, res) => {
  res.json({ pbkdf2InFlight, fsInFlight });
});

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Auth & Profile API listening on port ${PORT}`);
  console.log('Run `node load.js` in a separate terminal to simulate traffic.');
  console.log(
    `UV_THREADPOOL_SIZE is currently ${process.env.UV_THREADPOOL_SIZE || '4 (default)'}.`,
  );
});
