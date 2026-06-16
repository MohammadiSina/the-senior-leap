const http = require('http');

const TOTAL_ORDERS = 50;
const CONCURRENT = 5;
const BATCH_DELAY = 200;

let created = 0;
let completed = 0;
let failed = 0;
let connectionErrors = 0;

function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (c) => (responseBody += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(responseBody) });
        } catch {
          resolve({ status: res.statusCode, body: responseBody });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function createOrder(sku, email) {
  return makeRequest('POST', '/orders', { sku, email });
}

async function sendWebhook(order, qty) {
  return makeRequest('POST', '/webhook', {
    orderId: order.id,
    sku: order.sku,
    qty,
    email: order.email,
  });
}

async function processOrder(order, qty) {
  try {
    const res = await sendWebhook(order, qty);
    if (res.status === 200) {
      completed++;
      console.log(`  [ok] ${order.id} — charge: ${res.body.chargeId}`);
    } else {
      failed++;
      console.log(`  [fail] ${order.id} — ${res.body.error}`);
    }
  } catch (err) {
    connectionErrors++;
    console.error(`  [error] ${order.id} — ${err.message}`);
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== Order Processing Load Test ===\n');
  console.log(`Creating ${TOTAL_ORDERS} orders...\n`);

  const orders = [];
  for (let i = 0; i < TOTAL_ORDERS; i++) {
    const sku = `SKU-${(i % 50) + 1}`;
    const email = `customer${i + 1}@example.com`;
    try {
      const res = await createOrder(sku, email);
      if (res.status === 201) {
        orders.push(res.body);
        created++;
      }
    } catch (err) {
      console.error(`  [create-error] ${err.message}`);
    }
  }

  console.log(`\nCreated ${created} orders.`);
  console.log(`\nSending webhooks (batch size: ${CONCURRENT})...\n`);

  for (let i = 0; i < orders.length; i += CONCURRENT) {
    const batch = orders.slice(i, i + CONCURRENT);
    await Promise.all(batch.map((o) => processOrder(o, 1)));
    await delay(BATCH_DELAY);
  }

  // Wait for in-flight requests
  console.log('\nWaiting for in-flight requests...');
  await delay(2000);

  // Check inventory
  console.log('\n--- Inventory Report ---');
  try {
    const invRes = await makeRequest('GET', '/inventory');
    if (invRes.status === 200) {
      const items = invRes.body;
      const totalStock = items.reduce((sum, item) => sum + item.stock, 0);
      const initialStock = 50 * 100; // 50 SKUs * 100 units
      const expectedStock = initialStock - completed;
      const drift = totalStock - expectedStock;

      console.log(`  Initial stock: ${initialStock}`);
      console.log(`  Orders completed (charged): ${completed}`);
      console.log(`  Expected remaining: ${expectedStock}`);
      console.log(`  Actual remaining: ${totalStock}`);
      console.log(`  Drift: ${drift}`);

      if (drift !== 0) {
        console.log(`\n  ⚠  Inventory drift detected!`);
        console.log(`  Stock was decremented for ${Math.abs(drift)} order(s) that weren't charged.`);
      }
    }
  } catch (err) {
    console.log('  Could not fetch inventory — server may have crashed.');
    console.log(`  Error: ${err.message}`);
  }

  console.log('\n--- Summary ---');
  console.log(`  Created:  ${created}`);
  console.log(`  Completed: ${completed}`);
  console.log(`  Failed (charge): ${failed}`);
  console.log(`  Connection errors: ${connectionErrors}`);
  console.log(`  Processed: ${completed + failed + connectionErrors}/${created}`);

  if (connectionErrors > 0) {
    console.log('\n  ⚠  Connection errors suggest the server crashed mid-processing.');
    console.log('  Check the server terminal for error output.');
  }
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
