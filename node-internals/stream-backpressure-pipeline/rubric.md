# Rubric — Stream Backpressure & Pipeline Failure

> Open this only after writing your analysis in `my-analysis.md`.
> The rubric works best as a mirror, not a guide.

---

## What a Senior Engineer Would Notice

Items are grouped by how much their absence reveals a gap in thinking.

---

### 🔴 Critical

**The Transform stream accumulates records in memory instead of flowing them through.**

The `enricher` transform's `transform()` method pushes nothing — it appends each record to `this._batch`. The `flush()` method then pushes everything at once. This means the entire dataset is held in memory for the duration of the pipeline. For a 40MB file, that's tens of megabytes in a single transform's internal state. For a 400MB file, it's hundreds.

The purpose of a Transform stream is to receive data, do something to it, and push the result downstream immediately — keeping memory usage proportional to the current chunk, not the total input. By accumulating and flushing at the end, this code negates the entire point of streaming. The fix isn't "more memory" — it's `this.push(record)` inside `transform()`, one record at a time, letting backpressure naturally throttle the read side.

---

**`.pipe()` doesn't destroy sibling streams on error.**

The code uses `.pipe()` to connect four streams: read → parse → enrich → write. Each stream has its own `error` event handler that logs the error. But none of those handlers destroy the other streams.

If the write stream errors (e.g., disk full, permission denied), the read stream and parser keep running. They continue reading from disk, producing objects, and allocating memory — for a pipeline that has already failed. The file descriptor stays open. The read stream's internal buffer fills. The process eventually runs out of file descriptors or memory.

`stream.pipeline()` was built specifically for this: when any stream in the chain errors, all streams are destroyed and the callback receives the error. Using `.pipe()` with manual error handlers is the most common source of stream resource leaks in production.

---

### 🟡 Important

**The `flush()` method pushes the entire accumulated batch at once.**

Even if you identify the accumulation bug, `flush()` is where the bill comes due. When the read stream finishes, `flush()` iterates over every record in `this._batch` and pushes each one downstream. For 100k+ records, this creates a massive spike in the output stream's buffer. The write stream may not be able to absorb it all at once, and there's no backpressure mechanism at this point — the transform is being torn down, not actively processing.

A senior would note that `flush()` should only handle genuinely buffered partial data (like an incomplete line at the end of a chunk), not the entire dataset.

---

**Backpressure from the write stream never reaches the read stream.**

In a properly composed pipeline, when the write stream's buffer fills up, it signals the transform to slow down, which signals the read stream to stop reading. This is the entire reason streams exist: to let the slowest component set the pace.

Because the enricher accumulates instead of flowing, it never returns `false` from `push()`, and the read stream never gets throttled. It reads the entire file as fast as the OS can deliver it, regardless of how fast the downstream can process it.

---

### 🟢 Bonus

**The error handlers are a code smell even if they don't crash anything.**

Each stream has an independent `error` handler that logs and continues. In a well-designed pipeline, you handle errors once — in the `pipeline()` callback. Having four separate error handlers that all just log suggests the developer knew errors could happen but didn't understand how they propagate through stream chains.

---

**`--max-old-space-size` is a symptom-level fix that the team already tried.**

If your analysis mentions that increasing the memory limit is treating the symptom, not the cause — you're thinking at the right level. The process needs a fixed amount of memory proportional to the *current chunk*, not the *total file*. A 500MB file should process with a few MB of heap, not gigabytes.

---

## Common Mistakes

**Thinking the fix is just "use pipeline()".** `pipeline()` fixes the error handling and cleanup issue, but it doesn't fix the memory accumulation. If you switch to `pipeline()` without changing the enricher to flow data through, the process still OOMs. Both bugs need fixing.

**Blaming the file size.** "The file is too big for Node.js" is wrong. Node.js streams are specifically designed to handle files of any size with constant memory — *if used correctly*. The bug isn't the file size; it's how the stream is used.

**Missing the flush() problem.** Some people identify the accumulation but think `flush()` is the fix — "it pushes everything at the end, so the data does get processed." That's true, but `flush()` pushing 100k objects at once creates a memory spike and defeats backpressure. It's not a fix; it's where the OOM happens.

**Thinking `.pipe()` handles errors.** Many Node.js developers assume `.pipe()` automatically handles errors the way `try/catch` handles synchronous errors. It doesn't. Each stream must be error-handled independently, and errors on one stream don't affect the others.
