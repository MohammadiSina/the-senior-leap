const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Mock database fetch. In production, this would be a PostgreSQL query.
function fetchEvents() {
  const events = [];
  // Generating 300k records to simulate a large daily event dump
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

function generateSummary() {
  const events = fetchEvents();

  // Sort chronologically to ensure accurate time-series analysis
  const sortedEvents = [...events].sort((a, b) => a.ts - b.ts);

  const summary = {};

  // Aggregate metrics per category
  for (const event of sortedEvents) {
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

  // Calculate averages and format output
  const result = Object.entries(summary).map(([category, metrics]) => {
    // Sort values per category to calculate the median
    metrics.values.sort((a, b) => a - b);

    return {
      category,
      average: metrics.totalValue / metrics.count,
      median: metrics.values[Math.floor(metrics.values.length / 2)],
      min: metrics.min,
      max: metrics.max,
    };
  });

  return result;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/reports/summary', async (req, res) => {
  // Wrapped in async/await to ensure the heavy computation doesn't block the event loop
  const summary = await Promise.resolve(generateSummary());
  res.json({ generatedAt: Date.now(), data: summary });
});

app.listen(PORT, () => {
  console.log(`Analytics API listening on port ${PORT}`);
});
