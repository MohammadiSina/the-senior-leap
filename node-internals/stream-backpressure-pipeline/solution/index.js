const express = require('express');
const fs = require('fs');
const path = require('path');
const { Transform, pipeline } = require('stream');

const app = express();
app.use(express.json());

const OUTPUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

let processing = 0;

app.post('/process', (req, res) => {
  const { file } = req.body;
  if (!file || !fs.existsSync(file)) {
    return res.status(400).json({ error: 'file not found' });
  }

  processing++;
  const outputFile = path.join(OUTPUT_DIR, `out-${Date.now()}.ndjson`);
  const writeStream = fs.createWriteStream(outputFile);

  const readStream = fs.createReadStream(file, { encoding: 'utf8' });

  let buffer = '';
  const parser = new Transform({
    objectMode: true,
    transform(chunk, enc, cb) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) {
          try {
            this.push(JSON.parse(line));
          } catch (e) {
            /* skip malformed lines */
          }
        }
      }
      cb();
    },
    flush(cb) {
      if (buffer.trim()) {
        try {
          this.push(JSON.parse(buffer));
        } catch (e) {
          /* skip */
        }
      }
      cb();
    },
  });

  let count = 0;
  const enricher = new Transform({
    objectMode: true,
    // FIX 1: Push each record through immediately instead of accumulating.
    // The old code stored everything in this._batch and dumped it in flush().
    // That defeats the entire purpose of streaming — memory grows linearly
    // with input size instead of staying constant.
    //
    // With this.push(record), the transform signals to the read stream
    // "I'm ready for more" only when the downstream is ready. Backpressure
    // propagates naturally: if the write stream is slow, push() returns false,
    // the transform stops reading, and the read stream stops pulling from disk.
    transform(record, enc, cb) {
      this.push({
        ...record,
        level: (record.level || 'info').toUpperCase(),
        processed: true,
        ts: new Date().toISOString(),
      });
      count++;
      cb();
    },
    // No flush() needed — there's nothing to accumulate.
  });

  // FIX 2: Use pipeline() instead of .pipe() for automatic stream lifecycle
  // management. When any stream in the chain errors (disk full, connection
  // reset, etc.), pipeline() destroys all streams and calls the callback
  // with the error. No leaked file descriptors, no orphaned reads.
  //
  // The old code had four separate .on('error') handlers that each logged
  // and continued — the other streams kept running after a failure.
  pipeline(readStream, parser, enricher, writeStream, (err) => {
    processing--;
    if (err) {
      console.error(`[pipeline] ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
    console.log(`[done] ${count} records → ${outputFile}`);
    res.json({ status: 'done', records: count, output: outputFile });
  });
});

setInterval(() => {
  if (processing === 0) return;
  const m = process.memoryUsage();
  const mb = (n) => `${Math.round(n / 1024 / 1024)}MB`;
  console.log(
    `[mem] rss=${mb(m.rss)} heap=${mb(m.heapUsed)}/${mb(m.heapTotal)} processing=${processing}`,
  );
}, 10_000).unref();

app.listen(3000, () => {
  console.log('Data Processor listening on port 3000');
});
