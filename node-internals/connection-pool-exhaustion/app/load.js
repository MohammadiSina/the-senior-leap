'use strict';

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const CONCURRENCY = 20;
const HEALTH_INTERVAL = 200;
const ORDER_INTERVAL = 100;
const PROFILE_INTERVAL = 2000;
const LATENCY_WARN = 200;

let stats = { orders: 0, profiles: 0, healthOk: 0, healthSlow: 0, timeouts: 0 };

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          resolve({ status: res.statusCode, latency: Date.now() - start, body: data });
        });
      }
    );
    req.on('error', (err) => {
      resolve({ status: 0, latency: Date.now() - start, error: err.message });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ status: 0, latency: Date.now() - start, error: 'timeout' });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function healthCheck() {
  const res = await request('GET', '/health');
  if (res.error) {
    console.log(`[health] FAILED — ${res.error}`);
    return;
  }
  if (res.latency > LATENCY_WARN) {
    stats.healthSlow++;
    console.log(`[health] ${res.latency}ms — SLOW`);
  } else {
    stats.healthOk++;
    process.stdout.write(`.`);
  }
}

async function sendOrder(i) {
  const res = await request('POST', '/orders', { userId: `user-${i}`, item: `item-${i}` });
  stats.orders++;
  if (res.error || res.status >= 400) {
    stats.timeouts++;
    console.log(`\n[order] #${i} ${res.status || 'ERR'} ${res.latency}ms — ${res.error || ''}`);
  }
}

async function sendProfile(i) {
  const res = await request('GET', `/profile/${(i % 50) + 1}`);
  stats.profiles++;
  if (res.error || res.status >= 400) {
    stats.timeouts++;
    console.log(`\n[profile] #${i} ${res.status || 'ERR'} ${res.latency}ms — ${res.error || ''}`);
  } else if (res.latency > LATENCY_WARN) {
    console.log(`\n[profile] #${i} ${res.latency}ms — slow`);
  }
}

async function fetchPoolStats() {
  const res = await request('GET', '/pool-stats');
  if (res.body) {
    try {
      const stats = JSON.parse(res.body);
      console.log(`\n[pool] total=${stats.total} idle=${stats.idle} waiting=${stats.waiting} timeouts=${stats.timeouts}`);
    } catch (e) {}
  }
}

// ─── Phases ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('Connection Pool Exhaustion — Load Simulator');
  console.log('='.repeat(50));
  console.log(`Phase 1 (0–5s):    baseline — health checks only`);
  console.log(`Phase 2 (5–25s):   order traffic starts`);
  console.log(`Phase 3 (25–45s):  profile traffic joins`);
  console.log(`Phase 4 (45–60s):  both combined`);
  console.log('='.repeat(50));
  console.log();

  const startTime = Date.now();
  let orderCounter = 0;
  let profileCounter = 0;

  // Health checks — continuous
  setInterval(healthCheck, HEALTH_INTERVAL);

  // Pool stats — every 5 seconds
  setInterval(fetchPoolStats, 5000);

  // Phase control
  const check = () => (Date.now() - startTime) / 1000;

  // Order requests — start at 5s
  setTimeout(() => {
    console.log('\n--- Phase 2: order traffic starting ---\n');
    const orderTimer = setInterval(() => {
      sendOrder(orderCounter++);
    }, ORDER_INTERVAL);

    // Stop orders at 45s (but resume with profiles)
    setTimeout(() => clearInterval(orderTimer), 40_000);
  }, 5000);

  // Profile requests — start at 25s, burst of CONCURRENCY every PROFILE_INTERVAL
  setTimeout(() => {
    console.log('\n--- Phase 3: profile traffic starting ---\n');
    const profileTimer = setInterval(() => {
      for (let j = 0; j < CONCURRENCY; j++) {
        sendProfile(profileCounter++);
      }
    }, PROFILE_INTERVAL);

    // Stop profiles at 45s
    setTimeout(() => clearInterval(profileTimer), 20_000);
  }, 25_000);

  // Phase 4 — both combined
  setTimeout(() => {
    console.log('\n--- Phase 4: combined traffic ---\n');
    const comboOrder = setInterval(() => sendOrder(orderCounter++), ORDER_INTERVAL);
    const comboProfile = setInterval(() => {
      for (let j = 0; j < CONCURRENCY; j++) {
        sendProfile(profileCounter++);
      }
    }, PROFILE_INTERVAL);

    // End at 60s
    setTimeout(() => {
      clearInterval(comboOrder);
      clearInterval(comboProfile);
      console.log('\n\n=== FINAL STATS ===');
      console.log(`Orders: ${stats.orders}`);
      console.log(`Profiles: ${stats.profiles}`);
      console.log(`Health OK: ${stats.healthOk} | Slow: ${stats.healthSlow}`);
      console.log(`Timeouts/Errors: ${stats.timeouts}`);
      process.exit(0);
    }, 15_000);
  }, 45_000);
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
