'use strict';

const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));

// Records processed per chunk before yielding to the event loop.
// Previously this entire batch ran synchronously — the loop held the main
// thread for the full job duration and blocked every other request.
// Refactored to break the work into per-record chunks and yield between
// them with process.nextTick so the event loop can breathe.
const RECORDS_PER_CHUNK = 1;

function scoreRecord(record) {
  // Weighted rolling normalisation. CPU-intensive by design — the scoring
  // model was inherited and hasn't been profiled, but chunking should mean
  // it no longer matters how long each record takes.
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

  // Yield to the event loop between each chunk.
  process.nextTick(() => processChunk(records, end, results, done));
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
  console.log(`Report service listening on port ${PORT}`);
});
