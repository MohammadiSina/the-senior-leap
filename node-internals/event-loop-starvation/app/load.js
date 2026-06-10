const http = require('http');

const BASELINE_DURATION = 2000; // 2 seconds of clean health checks
const HEALTH_INTERVAL = 100; // Health check every 100ms
const REPORT_INTERVAL = 6000; // Report request every 6 seconds
const HEALTH_WARN_THRESHOLD = 50; // Mark health checks > 50ms with a warning

let healthChecks = 0;
let reportChecks = 0;

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.get(`http://localhost:3000${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, latency: Date.now() - start });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runHealthCheck() {
  try {
    const res = await makeRequest('/health');
    healthChecks++;
    const warn = res.latency > HEALTH_WARN_THRESHOLD ? ' ⚠' : '';
    console.log(`[health] #${healthChecks} latency: ${res.latency}ms${warn}`);
  } catch (err) {
    console.error(`[health] failed: ${err.message}`);
  }
}

async function runReportCheck() {
  try {
    console.log(`\n[report] firing request...`);
    const res = await makeRequest('/reports/summary');
    reportChecks++;
    console.log(`[report] #${reportChecks} latency: ${res.latency}ms\n`);
  } catch (err) {
    console.error(`[report] failed: ${err.message}`);
  }
}

console.log('Starting load simulator...');
console.log(`Baseline period: ${BASELINE_DURATION}ms`);
console.log(
  `Health checks every ${HEALTH_INTERVAL}ms | Warn threshold: ${HEALTH_WARN_THRESHOLD}ms`,
);
console.log(`Report checks every ${REPORT_INTERVAL}ms`);
console.log('-----------------------------------------');

const healthTimer = setInterval(runHealthCheck, HEALTH_INTERVAL);

setTimeout(() => {
  console.log('\n--- Baseline complete, starting report traffic ---\n');
  runReportCheck();
  setInterval(runReportCheck, REPORT_INTERVAL);
}, BASELINE_DURATION);

// Keep the process alive
setInterval(() => {}, 10000);
