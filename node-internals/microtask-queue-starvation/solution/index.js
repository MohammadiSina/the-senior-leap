'use strict';

const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));

const RECORDS_PER_CHUNK = 1;

function scoreRecord(record) {
  let acc = record.value || 1;
  for (let j = 1; j <= 800_000; j++) {
    acc = Math.sqrt(j * acc + 1) % 1e6;
  }
  return Math.round(acc * 1000) / 1000;
}

function processChunk(records, offset, results, done) {
  if (offset >= records.length) {
    return done(results);
  }

  const end = Math.min(offset + RECORDS_PER_CHUNK, records.length);

  for (let i = offset; i < end; i++) {
    results.push({ id: records[i].id, score: scoreRecord(records[i]) });
  }

  // FIX: use setImmediate, not process.nextTick.
  //
  // process.nextTick schedules callbacks in Node's nextTick queue (and Promise
  // microtasks land in a similar queue). Both queues are drained *entirely*
  // before the event loop is allowed to advance to its next phase. A recursive
  // nextTick chain — where each callback schedules another before returning —
  // keeps that queue perpetually non-empty. The loop never reaches the poll
  // phase, so no I/O callbacks (including incoming HTTP requests) can fire.
  // The server is technically "not blocking" in that no single synchronous call
  // holds the thread — but it is starving the poll phase just as completely.
  //
  // setImmediate schedules callbacks in the check phase, which comes *after*
  // the poll phase. Switching to setImmediate means every chunk is separated by
  // a full event loop iteration: timers are checked, the poll phase runs and can
  // drain pending I/O (health checks, new requests), and only then does the next
  // chunk begin. That is the yield point that actually lets I/O through.
  setImmediate(() => processChunk(records, end, results, done));
}

app.post('/report', (req, res) => {
  const { records } = req.body;

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: '`records` must be a non-empty array' });
  }

  const started = Date.now();

  processChunk(records, 0, [], (results) => {
    res.json({ scored: results.length, duration_ms: Date.now() - started });
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

app.listen(PORT, () => {
  console.log(`Report service (fixed) listening on port ${PORT}`);
});
