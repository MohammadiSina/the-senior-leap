const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEST_DIR = path.join(__dirname, 'test-data');
if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

const FILE_COUNT = 3;
const RECORDS_PER_FILE = 200000;
const SERVICES = ['auth', 'payments', 'orders', 'inventory', 'notifications'];
const LEVELS = ['info', 'warn', 'error', 'debug'];

function generateTestFile(index) {
  const filename = `data-${index}.ndjson`;
  const filePath = path.join(TEST_DIR, filename);
  const stream = fs.createWriteStream(filePath);

  for (let i = 0; i < RECORDS_PER_FILE; i++) {
    const record = {
      id: index * RECORDS_PER_FILE + i + 1,
      timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
      level: LEVELS[Math.floor(Math.random() * LEVELS.length)],
      service: SERVICES[Math.floor(Math.random() * SERVICES.length)],
      message: `Event ${i + 1}: User action recorded`,
      metadata: {
        ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        requestId: crypto.randomUUID(),
      },
    };
    stream.write(JSON.stringify(record) + '\n');
  }

  stream.end();
  return { filename, filePath };
}

function processFile(filePath) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ file: filePath });
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/process',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Invalid response: ${body}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`Generating ${FILE_COUNT} test files (${RECORDS_PER_FILE} records each)...\n`);
  const start = Date.now();

  const files = [];
  for (let i = 0; i < FILE_COUNT; i++) {
    const { filename, filePath } = generateTestFile(i);
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`  ${filename} — ${sizeMB}MB`);
    files.push(filePath);
  }

  console.log(`\nGenerated in ${(Date.now() - start) / 1000}s`);
  console.log(`\nSending ${FILE_COUNT} concurrent processing requests...\n`);

  const processStart = Date.now();
  const results = await Promise.all(files.map((f) => processFile(f)));

  console.log(`\nAll done in ${(Date.now() - processStart) / 1000}s`);
  results.forEach((r) => {
    if (r.error) {
      console.log(`  FAILED: ${r.error}`);
    } else {
      console.log(`  ${r.records} records → ${r.output}`);
    }
  });
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
