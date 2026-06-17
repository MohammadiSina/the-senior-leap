'use strict';

// Simulates a pg.Pool without requiring an actual PostgreSQL server.
// Same API surface — pool.connect(), client.release(), pool.query(),
// pool.idleCount, pool.waitingCount, pool.totalCount.
//
// Swap this for real pg.Pool by changing one import.

const QUERY_LATENCY_MIN = 5;
const QUERY_LATENCY_MAX = 100;

class MockClient {
  constructor(pool) {
    this._pool = pool;
    this._released = false;
  }

  async query(text, params) {
    if (this._released) throw new Error('Cannot query a released client');
    const ms = Math.floor(Math.random() * (QUERY_LATENCY_MAX - QUERY_LATENCY_MIN + 1)) + QUERY_LATENCY_MIN;
    await new Promise((r) => setTimeout(r, ms));

    if (Math.random() < this._pool._failRate) {
      throw new Error('violates check constraint "orders_status_check"');
    }

    return { rows: [{ ok: true }], rowCount: 1 };
  }

  release() {
    if (this._released) return;
    this._released = true;
    this._pool._returnClient(this);
  }
}

class MockPool {
  constructor({ max = 10, connectionTimeoutMillis = 3000, failRate = 0 } = {}) {
    this._max = max;
    this._connectionTimeoutMillis = connectionTimeoutMillis;
    this._failRate = failRate;
    this._idle = [];
    this._waiting = [];
    this._active = 0;
    this._timeouts = 0;

    for (let i = 0; i < max; i++) {
      this._idle.push(new MockClient(this));
    }
  }

  get idleCount() {
    return this._idle.length;
  }

  get totalCount() {
    return this._active + this._idle.length;
  }

  get waitingCount() {
    return this._waiting.length;
  }

  get timeoutCount() {
    return this._timeouts;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this._idle.length > 0) {
        const client = this._idle.pop();
        client._released = false;
        this._active++;
        return resolve(client);
      }

      const timer = setTimeout(() => {
        const idx = this._waiting.findIndex((w) => w.resolve === wrappedResolve);
        if (idx !== -1) this._waiting.splice(idx, 1);
        this._timeouts++;
        reject(new Error('Connection request timed out'));
      }, this._connectionTimeoutMillis);

      const wrappedResolve = (client) => {
        clearTimeout(timer);
        client._released = false;
        this._active++;
        resolve(client);
      };

      this._waiting.push({ resolve: wrappedResolve, timer });
    });
  }

  _returnClient(client) {
    this._active--;
    if (this._waiting.length > 0) {
      const { resolve } = this._waiting.shift();
      resolve(client);
    } else {
      this._idle.push(client);
    }
  }

  async query(text, params) {
    const client = await this.connect();
    try {
      return await client.query(text, params);
    } finally {
      client.release();
    }
  }
}

const pool = new MockPool({
  max: 10,
  connectionTimeoutMillis: 3000,
  failRate: 0.1,
});

module.exports = { pool, MockPool, MockClient };
