'use strict';

const { parentPort } = require('worker_threads');
const crypto = require('crypto');

// This worker does password hashing exclusively, on its own V8 thread.
// It never competes with fs/dns/zlib for libuv's shared thread pool, and
// it never touches the main thread — the event loop stays free no matter
// how much hashing load arrives.

parentPort.on('message', ({ taskId, password, salt, iterations, keylen, digest }) => {
  try {
    // pbkdf2Sync is the right call here — this thread exists for exactly
    // this work, so blocking it is the point. There's nothing else this
    // thread needs to be free for.
    const derivedKey = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), iterations, keylen, digest);
    parentPort.postMessage({ taskId, hash: derivedKey.toString('hex') });
  } catch (err) {
    parentPort.postMessage({ taskId, error: err.message });
  }
});
