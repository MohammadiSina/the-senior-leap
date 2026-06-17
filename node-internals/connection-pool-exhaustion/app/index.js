'use strict';

const express = require('express');
const { pool } = require('./db');

const app = express();
app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────────────────

// PLACE ORDER
app.post('/orders', async (req, res, next) => {
  try {
    const { userId, item } = req.body;
    if (!userId || !item) {
      return res.status(400).json({error: 'userId and item are required'});
    }

    const client = await pool.connect();
    const result = await client.query(
      'INSERT INTO orders (user_id, item) VALUES ($1, $2) RETURNING *',
      [userId, item]
    );
    client.release();
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// USER PROFILE
app.get('/profile/:id', async (req, res, next) => {
  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT * FROM users WHERE id = $1',
      [req.params.id]
    );

    const recommendations = await new Promise((resolve) => {
      setTimeout(() => {
        resolve(['item-a', 'item-b', 'item-c']);
      }, 500 + Math.random() * 1500);
    });

    client.release();

    res.json({ user: result.rows[0], recommendations });
  } catch (err) {
    next(err);
  }
});

// HEALTH
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// POOL STATS
app.get('/pool-stats', (req, res) => {
  res.json({
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    timeouts: pool.timeoutCount,
  });
});

// Error handler — keeps the server alive when routes throw.
app.use((err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.path} — ${err.message}`);
  res.status(500).json({ error: err.message });
});

// ─── Memory & Pool Reporter ──────────────────────────────────────────────────

setInterval(() => {
  const m = process.memoryUsage();
  const mb = (n) => `${Math.round(n / 1024 / 1024)}MB`;
  console.log(
    `[stats] pool: ${pool.totalCount} total, ${pool.idleCount} idle, ${pool.waitingCount} waiting | ` +
    `mem: rss=${mb(m.rss)} heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}`
  );
}, 10_000).unref();

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Order API listening on port ${PORT}`);
  console.log('Run `node load.js` in a separate terminal to simulate traffic.');
  console.log('Open /pool-stats to see connection pool state.');
});
