const { parentPort } = require('worker_threads');
const crypto = require('crypto');

// This worker runs in a separate V8 thread.
// It has its own event loop and memory space, so heavy CPU work here
// will not block the main thread's ability to handle HTTP requests.

parentPort.on('message', (task) => {
  if (task.type === 'GENERATE_SUMMARY') {
    const events = generateMockEvents();
    const summary = processEvents(events);
    parentPort.postMessage({ type: 'SUMMARY_RESULT', taskId: task.taskId, data: summary });
  }
});

function generateMockEvents() {
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

function processEvents(events) {
  // ALGORITHMIC FIX: Removed the unnecessary O(n log n) chronological sort.
  // It wasn't needed for the aggregation and was the dominant CPU cost.

  const summary = {};
  for (const event of events) {
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

  return Object.entries(summary).map(([category, metrics]) => {
    // We still need to sort per-category to find the median, but sorting
    // five 60k arrays is much faster than sorting one 300k array.
    metrics.values.sort((a, b) => a - b);

    return {
      category,
      average: metrics.totalValue / metrics.count,
      median: metrics.values[Math.floor(metrics.values.length / 2)],
      min: metrics.min,
      max: metrics.max,
    };
  });
}
