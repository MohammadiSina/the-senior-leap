const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// --- SETIMMEDIATE CHUNKING ARCHITECTURE ---
// If we don't want the architectural overhead of worker threads,
// we can break the synchronous work into smaller chunks.
// By yielding to the event loop periodically using setImmediate(),
// we allow pending I/O callbacks (like health checks) to execute between chunks.
// Tradeoff: The total time to generate the report increases slightly due to the
// overhead of yielding, but the server remains responsive to other requests.

function fetchEvents() {
  const events = [];
  for (let i = 0; i < 300000; i++) {
    events.push({
      id: crypto.randomUUID(),
      ts: Date.now() - Math.floor(Math.random() * 86400000),
      category: ['auth', 'payment', 'navigation', 'error', 'success'][
        Math.floor(Math.random() * 5)
      ],
      value: Math.random() * 100,
    });
  }
  return events;
}

// Helper to yield to the event loop
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

async function generateSummaryChunked() {
  const events = fetchEvents();

  // 1. ALGORITHMIC FIX: Removed the unnecessary O(n log n) chronological sort.

  const summary = {};
  const CHUNK_SIZE = 10000; // Process 10k events per chunk

  // 2. CHUNKING THE LOOP: Break the aggregation into pieces
  for (let i = 0; i < events.length; i += CHUNK_SIZE) {
    const chunk = events.slice(i, i + CHUNK_SIZE);

    for (const event of chunk) {
      if (!summary[event.category]) {
        summary[event.category] = {
          count: 0,
          totalValue: 0,
          min: Infinity,
          max: -Infinity,
          values: [],
        };
      }
      const cat = summary[event.category];
      cat.count++;
      cat.totalValue += event.value;
      if (event.value < cat.min) cat.min = event.value;
      if (event.value > cat.max) cat.max = event.value;
      cat.values.push(event.value);
    }

    // Yield to the event loop after every chunk.
    // This allows the poll phase to process incoming health check requests.
    await yieldToEventLoop();
  }

  const result = [];
  const entries = Object.entries(summary);

  for (const [category, metrics] of entries) {
    metrics.values.sort((a, b) => a - b);

    result.push({
      category,
      average: metrics.totalValue / metrics.count,
      median: metrics.values[Math.floor(metrics.values.length / 2)],
      min: metrics.min,
      max: metrics.max,
    });

    await yieldToEventLoop();
  }

  return result;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/reports/summary', async (req, res) => {
  // Now that the function is properly chunked and yields to the event loop,
  // the async/await pattern actually works as intended to keep the server responsive.
  const summary = await generateSummaryChunked();
  res.json({ generatedAt: Date.now(), data: summary });
});

app.listen(PORT, () => {
  console.log(`Analytics API (Chunking Solution) listening on port ${PORT}`);
});
