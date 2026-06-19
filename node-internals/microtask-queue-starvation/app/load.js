'use strict';

const http = require('http');

const HEALTH_INTERVAL = 100;    // health check every 100ms
const BASELINE_DURATION = 2000; // 2 seconds of clean baseline before the job
const HEALTH_WARN_MS = 50;      // flag health checks above this threshold

// Adjust RECORD_COUNT to control job duration.
// Each record takes roughly 8–15ms to score on typical hardware.
// 200 records targets ~1.6–3 seconds — long enough to observe multiple stalled checks.
const RECORD_COUNT = 200;

let healthCount = 0;

// ---------------------------------------------------------------------------

function request(method, path, body) {
  return new Promise((resolve) => {
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
        res.on('end', () =>
          resolve({ status: res.statusCode, latency: Date.now() - start, body: data })
        );
      }
    );
    req.on('error', (err) =>
      resolve({ status: 0, latency: Date.now() - start, error: err.message })
    );
    if (payload) req.write(payload);
    req.end();
  });
}

async function healthCheck() {
  const res = await request('GET', '/health');
  healthCount++;
  const warn = res.latency > HEALTH_WARN_MS ? ' ⚠' : '';
  console.log(`[health] #${healthCount} ${res.latency}ms${warn}`);
}

async function runJob() {
  const records = Array.from({ length: RECORD_COUNT }, (_, i) => ({
    id: `txn-${i}`,
    value: (i % 97) + 1,
  }));

  console.log(`\n--- Phase 2: submitting ${RECORD_COUNT}-record batch ---\n`);

  const res = await request('POST', '/report', { records });

  try {
    const body = JSON.parse(res.body);
    console.log(
      `\n--- batch complete: ${body.scored} records scored in ${body.duration_ms}ms ---\n`
    );
  } catch {
    console.log(`\n--- batch complete (${res.latency}ms total) ---\n`);
  }
}

// ---------------------------------------------------------------------------

console.log('Microtask Queue Starvation — Load Simulator');
console.log('='.repeat(50));
console.log(`Phase 1 (0–${BASELINE_DURATION / 1000}s):  baseline — health checks only`);
console.log(`Phase 2 (${BASELINE_DURATION / 1000}s+): batch job submitted`);
console.log(`Health every ${HEALTH_INTERVAL}ms | warn threshold: ${HEALTH_WARN_MS}ms`);
console.log(`Batch size: ${RECORD_COUNT} records`);
console.log('='.repeat(50));
console.log();

const healthTimer = setInterval(healthCheck, HEALTH_INTERVAL);

setTimeout(() => {
  runJob().then(() => {
    console.log('Phase 3: watching recovery for 2 seconds\n');
    setTimeout(() => {
      clearInterval(healthTimer);
      console.log(`\nTotal health checks completed: ${healthCount}`);
      process.exit(0);
    }, 2000);
  });
}, BASELINE_DURATION);

// keep the process alive between phases
setInterval(() => {}, 30_000);
