'use strict';

// Solution: Full fix — both bugs fixed, plus observability and timeouts.
//
// Changes from the broken version:
// 1. /orders: try/finally around checkout → release (leak fix)
// 2. /profile: release before external API call (hold-too-long fix)
// 3. connectionTimeoutMillis: 3000 on the pool (fail fast)
// 4. /pool-stats endpoint with real-time diagnostics
//
// In a real app, you'd also:
// - Use pool.query() for single-query routes (eliminates manual checkout/release)
// - Add pool stats to /healthz or /metrics
// - Alert on pool.waitingCount > 0 sustained over time

const express = require('express');
const { pool } = require('../app/db');

const app = express();
app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post('/orders', async (req, res) => {
  const { userId, item } = req.body;
  if (!userId || !item) {
    return res.status(400).json({ error: 'userId and item are required' });
  }

  // Even better: use pool.query() for single-query routes.
  // It handles checkout/release internally with proper try/finally.
  const client = await pool.connect();
  try {
    const result = await client.query(
      'INSERT INTO orders (user_id, item) VALUES ($1, $2) RETURNING *',
      [userId, item]
    );
    res.status(201).json(result.rows[0]);
  } finally {
    client.release();
  }
});

app.get('/profile/:id', async (req, res) => {
  let userData;

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM users WHERE id = $1',
      [req.params.id]
    );
    userData = result.rows[0];
  } finally {
    client.release();
  }

  // External call happens AFTER the connection is released.
  // The pool is free to lend this connection to the next request immediately.
  const recommendations = await new Promise((resolve) => {
    setTimeout(() => {
      resolve(['item-a', 'item-b', 'item-c']);
    }, 500 + Math.random() * 1500);
  });

  res.json({ user: userData, recommendations });
});

// ─── Health & Diagnostics ────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Cheap, high-value production diagnostic.
// Exposing pool stats on a health endpoint lets ops distinguish
// "the database is slow" from "the pool is exhausted" in seconds.
app.get('/pool-stats', (req, res) => {
  const stats = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    timeouts: pool.timeoutCount,
  };

  // Add a warning flag if the pool is under pressure
  if (stats.waiting > 0 || stats.idle === 0) {
    stats.warning = 'pool_exhausted';
  }

  res.json(stats);
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`Order API (full fix) listening on port ${PORT}`);
});
