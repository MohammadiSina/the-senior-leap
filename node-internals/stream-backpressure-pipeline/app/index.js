const express = require('express');
const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');

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
    transform(record, enc, cb) {
      this._batch = this._batch || [];
      this._batch.push({
        ...record,
        level: (record.level || 'info').toUpperCase(),
        processed: true,
        ts: new Date().toISOString(),
      });
      count++;
      cb();
    },
    flush(cb) {
      for (const r of this._batch || []) {
        this.push(JSON.stringify(r) + '\n');
      }
      cb();
    },
  });

  readStream.on('error', (e) => console.error(`[read] ${e.message}`));
  parser.on('error', (e) => console.error(`[parser] ${e.message}`));
  enricher.on('error', (e) => console.error(`[enricher] ${e.message}`));
  writeStream.on('error', (e) => console.error(`[write] ${e.message}`));

  readStream.pipe(parser).pipe(enricher).pipe(writeStream);

  writeStream.on('finish', () => {
    processing--;
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
