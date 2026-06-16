'use strict';

const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ─── In-Memory Stores ────────────────────────────────────────────────────────

const orders = new Map();
const inventory = new Map();

// Seed inventory — 50 SKUs, 100 units each
for (let i = 1; i <= 50; i++) {
  inventory.set(`SKU-${i}`, { sku: `SKU-${i}`, stock: 100 });
}

// ─── Processing Pipeline ─────────────────────────────────────────────────────

async function validateOrder(orderId) {
  await simulateLatency(5, 20);
  const order = orders.get(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (order.status !== 'pending') throw new Error(`Order ${orderId} already ${order.status}`);
  return order;
}

async function chargeCard(orderId, amount) {
  // External payment API — slow, occasionally declines
  await simulateLatency(100, 500);
  if (Math.random() < 0.12) {
    throw new Error(`Payment declined for order ${orderId}`);
  }
  return { chargeId: `ch_${crypto.randomUUID().slice(0, 8)}`, amount };
}

async function updateInventory(orderId, sku, qty) {
  // Database write — fast
  await simulateLatency(5, 30);
  const item = inventory.get(sku);
  if (!item) throw new Error(`SKU ${sku} not found`);
  if (item.stock < qty) throw new Error(`Insufficient stock for ${sku}`);
  item.stock -= qty;
  return { sku, remaining: item.stock };
}

async function sendNotification(orderId, email) {
  // Email service — sometimes unavailable
  await simulateLatency(50, 200);
  if (Math.random() < 0.1) {
    throw new Error('Email service unavailable');
  }
  return { sent: true, email };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  const { orderId, sku, qty, email } = req.body;

  if (!orderId || !sku || !qty || !email) {
    return res.status(400).json({ error: 'orderId, sku, qty, and email are required' });
  }

  try {
    const order = await validateOrder(orderId);

    // Charge card and update inventory concurrently for performance
    const [charge, invUpdate] = await Promise.all([
      chargeCard(orderId, qty * 10),
      updateInventory(orderId, sku, qty),
    ]);

    order.status = 'completed';
    order.chargeId = charge.chargeId;

    // Fire-and-forget: confirmation email doesn't need to block the response
    sendNotification(orderId, email);

    res.json({
      status: 'completed',
      orderId,
      chargeId: charge.chargeId,
      inventory: invUpdate,
    });
  } catch (err) {
    const order = orders.get(orderId);
    if (order) order.status = 'failed';

    res.status(500).json({ error: err.message });
  }
});

// ─── Order Creation (for testing) ────────────────────────────────────────────

app.post('/orders', (req, res) => {
  const { sku, email } = req.body;
  if (!sku || !email) {
    return res.status(400).json({ error: 'sku and email required' });
  }
  const orderId = `ord_${crypto.randomUUID().slice(0, 8)}`;
  const order = {
    id: orderId,
    sku,
    email,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  orders.set(orderId, order);
  res.status(201).json(order);
});

// ─── Health & Inventory ──────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/inventory', (req, res) => {
  res.json(Array.from(inventory.values()));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function simulateLatency(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Memory Reporter ─────────────────────────────────────────────────────────

setInterval(() => {
  const m = process.memoryUsage();
  const mb = (n) => `${Math.round(n / 1024 / 1024)}MB`;
  console.log(`[mem] rss=${mb(m.rss)} heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}`);
}, 15_000).unref();

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Order Service listening on port ${PORT}`);
  console.log('Run `node load.js` in a separate terminal to simulate webhook traffic.');
});
