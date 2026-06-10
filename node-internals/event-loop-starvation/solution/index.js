const express = require('express');
const { Worker } = require('worker_threads');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- WORKER THREAD ARCHITECTURE ---
// Instead of running CPU-bound tasks on the main thread, we offload them to a worker.
// The worker runs in a separate V8 instance with its own event loop.
// This guarantees that heavy computation never delays incoming HTTP requests or health checks.

const worker = new Worker(path.join(__dirname, 'worker.js'));

// We use a simple Promise-based wrapper to handle the asynchronous message passing.
// In a larger app, you'd use a robust worker pool (like Piscina) to handle
// multiple concurrent CPU tasks and manage worker lifecycles.
let pendingTasks = {};
let taskIdCounter = 0;

worker.on('message', (msg) => {
  if (msg.type === 'SUMMARY_RESULT' && pendingTasks[msg.taskId]) {
    pendingTasks[msg.taskId].resolve(msg.data);
    delete pendingTasks[msg.taskId];
  }
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
  // In production, you'd want to restart the worker or fail gracefully
  Object.values(pendingTasks).forEach((task) => task.reject(err));
  pendingTasks = {};
});

function generateSummaryAsync() {
  return new Promise((resolve, reject) => {
    const taskId = ++taskIdCounter;
    pendingTasks[taskId] = { resolve, reject };
    worker.postMessage({ type: 'GENERATE_SUMMARY', taskId });
  });
}

app.get('/health', (req, res) => {
  // Because the heavy lifting is in the worker, this endpoint
  // remains consistently fast (<5ms) even under heavy report load.
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/reports/summary', async (req, res) => {
  try {
    // The main thread just sends a message to the worker and yields.
    // It can immediately go back to processing other HTTP requests.
    const summary = await generateSummaryAsync();
    res.json({ generatedAt: Date.now(), data: summary });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

app.listen(PORT, () => {
  console.log(`Analytics API (Worker Solution) listening on port ${PORT}`);
});
