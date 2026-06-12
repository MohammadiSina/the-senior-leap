# Streams, Backpressure, and `pipeline()`

> Already comfortable with Node.js streams and how backpressure works? Skip this and go straight to `README.md`.

---

## Why Streams Exist

Node.js streams process data piece by piece instead of loading everything into memory. A 500MB file piped through a stream doesn't require 500MB of RAM — it requires a few buffers holding the current chunk.

This is the promise. It's also where most people stop understanding.

---

## The Four Stream Types

**Readable** — a source of data. `fs.createReadStream()`, `http.IncomingMessage`, or anything that emits `data` events. A readable produces chunks that flow downstream.

**Writable** — a destination. `fs.createWriteStream()`, `res` (the HTTP response), or anything with a `write()` method. A writable consumes chunks.

**Transform** — a readable *and* a writable. Data goes in one end, something happens to it, and it comes out the other. `zlib.createGzip()`, JSON parsers, encryptors. A transform receives chunks via `transform()`, does its work, and calls `this.push()` to emit the result.

**Duplex** — a readable and writable that are independent (like a TCP socket). Rarely the source of bugs in application code.

Most stream bugs live in Transform streams — the place where "do something to each chunk" meets "but how fast should I pull the next one?"

---

## The Backpressure Mechanism

Every writable stream has a `highWaterMark` — a buffer size limit (default: 16KB for objectMode, 16KB for binary). When you call `writable.write(chunk)`:

- If the internal buffer is below the high water mark, `write()` returns `true`. Keep going.
- If the buffer is at or above the mark, `write()` returns `false`. **Stop writing.** Wait for the `drain` event before resuming.

For Transform streams, backpressure flows upstream: if the output side can't keep up, the transform's `push()` method returns `false`, signaling the transform to stop consuming input until the downstream drains.

**If you ignore the return value of `push()`, backpressure doesn't propagate.** The transform keeps pulling data from the source, accumulating it internally, and the whole point of streaming is lost.

---

## `.pipe()` vs `pipeline()`

**`.pipe(dest)`** connects a readable to a writable. It's been in Node.js since the beginning. It handles basic backpressure between the two streams.

What it doesn't handle:
- **Error propagation.** If stream B errors, stream A is not automatically destroyed. You get leaked file descriptors, hanging connections, and orphaned resources.
- **Cleanup on error.** If any stream in the chain fails, the others keep running. Manual cleanup is your problem.
- **Composition.** `.pipe()` returns the destination stream, making it easy to chain — but that chain is fragile.

**`stream.pipeline(src, ...transforms, dest, callback)`** was added to fix this. It:
- Automatically destroys all streams in the chain when any one of them errors
- Calls the callback with the error, so you can handle it in one place
- Ensures proper cleanup — no leaked resources

```javascript
const { pipeline } = require('stream');

pipeline(readStream, transform, writeStream, (err) => {
  if (err) {
    console.error('Pipeline failed:', err.message);
    // All streams are already destroyed
  } else {
    console.log('Done');
  }
});
```

If you're writing stream chains in production code, use `pipeline()`. Period.

---

## Common Misconceptions

- **"Streams are always constant-memory."** Only if you respect backpressure. A transform that accumulates internally is just a complicated way to read everything into memory.
- **"Errors on one stream crash the whole process."** They don't. Unhandled stream errors propagate to `process.on('uncaughtException')` if uncaught, but within a `.pipe()` chain, they're silently swallowed. The other streams keep running.
- **"`flush()` is for cleanup."** It is, but if `flush()` pushes large amounts of data, you've deferred the memory problem to the end instead of solving it.

---

## Further Reading

- [Node.js docs: Stream](https://nodejs.org/api/stream.html) — the official reference
- [Node.js docs: stream.pipeline()](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-callback) — why it exists and what it handles
- [Substack: Stream Adventures](https://github.com/substack/stream-adventure) — hands-on stream exercises
