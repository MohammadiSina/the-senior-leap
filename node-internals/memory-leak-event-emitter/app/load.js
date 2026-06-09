'use strict';

// Simulates a steady stream of API traffic so you can watch memory climb.
// Run this in a separate terminal while the server is running.
// No dependencies — uses Node's built-in http module.

const http = require('http');

const HOST = 'localhost';
const PORT = 3000;

let cycles = 0;
let errors = 0;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;

    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        // Drain the response so the socket can be reused
        res.resume();
        res.on('end', resolve);
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  console.log(`Sending traffic to http://${HOST}:${PORT}`);
  console.log('Watch the [mem] lines in the server terminal.');
  console.log('─'.repeat(50));

  while (true) {
    try {
      // Each cycle: two GETs and one POST.
      // The POST triggers a 'change' event on the store —
      // watch what happens to the audit log output.
      await request('GET', '/tasks');
      await request('POST', '/tasks', { title: `task-${cycles}` });
      await request('GET', '/tasks');

      cycles++;

      if (cycles % 200 === 0) {
        console.log(`[load] ${cycles} cycles sent — ${errors} errors`);
      }

      // ~20ms between cycles keeps pressure steady without flooding
      await new Promise((r) => setTimeout(r, 20));
    } catch (err) {
      errors++;
      if (errors % 10 === 0) {
        console.error(`[load] ${errors} errors — last: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
