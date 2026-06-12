# Stream Backpressure & Pipeline Failure

> The data processor works perfectly with test files. In production, with 300MB log files, it crashes with OOM after processing 80MB.

---

## Scenario

A team runs a data ingestion service. It reads NDJSON log files from disk, parses and validates each record, enriches them with metadata, and writes the results to output files. It's been working fine during development and staging — test files are 10-20MB, processing takes a few seconds.

Last week it went to production. The logging infrastructure writes NDJSON files ranging from 100MB to 500MB. Within hours of the first production run, the process crashes with `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`.

The team increases `--max-old-space-size` to 4096. It buys some time, but the process still eventually crashes. The fix is clearly not "more memory."

You've been handed the codebase and asked to explain why a streaming pipeline — something designed to handle arbitrary file sizes with constant memory — is consuming unbounded memory. And what to do about it.

---

## Your Task

1. **Run the app and the load generator** (see *How to Run* below). Watch the memory usage climb as the server processes files. Notice how quickly it grows relative to the file size.

2. **Read the processing pipeline code.** Something is wrong with how data flows through the transforms. Figure out what and why.

3. **Find every issue in the pipeline.** The memory problem is the most visible, but there's at least one more bug that will matter when things go wrong in production.

4. **Explain the mechanism.** Not just "it uses too much memory" but: what exactly is being retained, why the stream isn't behaving the way streams are supposed to, and what would happen if one part of the pipeline failed.

5. **Write your findings in `my-analysis.md`** before opening `rubric.md` or `solution/`.

A strong answer explains the mechanism precisely — the kind of answer you'd give in a post-mortem when someone asks "why did the data processor crash with 300MB input files?"

---

## Prerequisites

You should be comfortable with Node.js, Express, and the basics of streams (what a readable, writable, and transform stream are). If you've never used `stream.Transform`, read `tutorial.md` first.

---

## How to Run

**Terminal 1 — start the server:**

```bash
cd app
npm install
node index.js
```

**Terminal 2 — generate test data and trigger processing:**

```bash
node load.js
```

The load generator creates three NDJSON test files (200,000 records each, ~40MB) and sends them to the server for processing. Watch the memory output in Terminal 1.

---

## How to Self-Evaluate

Once you've written your analysis, open `rubric.md` and compare it against what a senior engineer would have noticed.

To get AI-assisted feedback on your reasoning:

```bash
cd ../../ai-evaluator
node evaluate.js --exercise ../node-internals/stream-backpressure-pipeline
```
