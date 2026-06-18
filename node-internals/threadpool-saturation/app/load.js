'use strict';

const http = require('http');

const HEALTH_INTERVAL = 200;
const WEATHER_INTERVAL = 1000;
const LOGIN_INTERVAL = 150;
const LOGIN_BURST = 5;
const AVATAR_INTERVAL = 150;
const AVATAR_BURST = 5;
const HEALTH_WARN_THRESHOLD = 150;
const WEATHER_WARN_THRESHOLD = 1200; // weather has its own ~300-800ms baseline

const stats = {
  logins: 0,
  avatars: 0,
  healthOk: 0,
  healthSlow: 0,
  weatherOk: 0,
  weatherSlow: 0,
};

function request(method, urlPath, body) {
  return new Promise((resolve) => {
    const start = Date.now();
    const payload = body ? JSON.stringify(body) : null;

    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, latency: Date.now() - start, body: data }));
      }
    );

    req.on('error', (err) => resolve({ status: 0, latency: Date.now() - start, error: err.message }));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ status: 0, latency: Date.now() - start, error: 'timeout' });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

async function healthCheck() {
  const res = await request('GET', '/health');
  if (res.error || res.latency > HEALTH_WARN_THRESHOLD) {
    stats.healthSlow++;
    console.log(`\n[health] ${res.error || res.latency + 'ms'} ⚠ — this should never happen here`);
  } else {
    stats.healthOk++;
    process.stdout.write('.');
  }
}

async function weatherCheck() {
  const res = await request('GET', '/weather');
  if (res.error || res.latency > WEATHER_WARN_THRESHOLD) {
    stats.weatherSlow++;
    console.log(`\n[weather] ${res.error || res.latency + 'ms'} ⚠ — this never touches the thread pool`);
  } else {
    stats.weatherOk++;
  }
}

async function sendLogin(i) {
  // Mostly wrong guesses, occasionally correct — same hashing cost either way.
  const password = i % 7 === 0 ? 'correct-password' : `guess-${i}`;
  const res = await request('POST', '/login', { password });
  stats.logins++;
  if (res.latency > 400) {
    console.log(`\n[login] #${i} ${res.latency}ms — queued`);
  }
}

async function sendAvatar(i) {
  const id = (i % 20) + 1;
  const res = await request('GET', `/avatar/${id}`);
  stats.avatars++;
  if (res.latency > 200) {
    console.log(`\n[avatar] #${i} ${res.latency}ms — queued`);
  }
}

async function fetchInflight() {
  const res = await request('GET', '/debug/inflight');
  if (res.body) {
    try {
      const d = JSON.parse(res.body);
      console.log(`\n[inflight] pbkdf2=${d.pbkdf2InFlight} fs=${d.fsInFlight}`);
    } catch (e) {
      /* ignore */
    }
  }
}

// ─── Phases ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('Thread Pool Saturation — Load Simulator');
  console.log('='.repeat(60));
  console.log('Phase 1 (0–5s):    baseline — health + weather only');
  console.log('Phase 2 (5–25s):   login traffic (password hashing)');
  console.log('Phase 3 (25–45s):  avatar traffic joins (login continues)');
  console.log('Phase 4 (45–60s):  both combined, full intensity');
  console.log('='.repeat(60));
  console.log();

  let loginCounter = 0;
  let avatarCounter = 0;

  // Control routes — running for the whole test.
  setInterval(healthCheck, HEALTH_INTERVAL);
  setInterval(weatherCheck, WEATHER_INTERVAL);
  setInterval(fetchInflight, 5000);

  // Phase 2 — login traffic starts at 5s, runs through phase 3, ends at 45s.
  setTimeout(() => {
    console.log('\n--- Phase 2: login traffic starting ---\n');
    const loginTimer = setInterval(() => {
      for (let j = 0; j < LOGIN_BURST; j++) sendLogin(loginCounter++);
    }, LOGIN_INTERVAL);
    setTimeout(() => clearInterval(loginTimer), 40_000);
  }, 5_000);

  // Phase 3 — avatar traffic joins at 25s, ends at 45s.
  setTimeout(() => {
    console.log('\n--- Phase 3: avatar traffic starting (login still running) ---\n');
    const avatarTimer = setInterval(() => {
      for (let j = 0; j < AVATAR_BURST; j++) sendAvatar(avatarCounter++);
    }, AVATAR_INTERVAL);
    setTimeout(() => clearInterval(avatarTimer), 20_000);
  }, 25_000);

  // Phase 4 — both restarted together for a final, sustained combined load.
  setTimeout(() => {
    console.log('\n--- Phase 4: combined traffic, full intensity ---\n');
    const comboLogin = setInterval(() => {
      for (let j = 0; j < LOGIN_BURST; j++) sendLogin(loginCounter++);
    }, LOGIN_INTERVAL);
    const comboAvatar = setInterval(() => {
      for (let j = 0; j < AVATAR_BURST; j++) sendAvatar(avatarCounter++);
    }, AVATAR_INTERVAL);

    setTimeout(() => {
      clearInterval(comboLogin);
      clearInterval(comboAvatar);
      console.log('\n\n=== FINAL STATS ===');
      console.log(`Logins:  ${stats.logins}`);
      console.log(`Avatars: ${stats.avatars}`);
      console.log(`Health  — OK: ${stats.healthOk}  Slow: ${stats.healthSlow}`);
      console.log(`Weather — OK: ${stats.weatherOk}  Slow: ${stats.weatherSlow}`);
      console.log('\nIf health/weather slow counts are 0, the event loop was never');
      console.log('the bottleneck — everything you saw was thread pool queuing.');
      process.exit(0);
    }, 15_000);
  }, 45_000);
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
