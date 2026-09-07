// serve.mjs — zero-dependency static dev server for local play/preview.
// Usage: node tools/serve.mjs [port]   (default 8321)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || Number(process.env.PORT) || 8321;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};

// POST /__trace/<name>.json — the in-game bug report (js/bugreport.js) handing back the
// match it just recorded. Written into traces/ next to the code, because that is where
// `node tools/replay-report.mjs traces/<file>` can reach it; a download in the player's
// Downloads folder is the fallback, not the goal. Dev-only, and deliberately narrow:
// the name is scrubbed to a basename and must end in .json, so nothing can be written
// outside traces/.
async function takeReport(req, res, name) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!safe.endsWith('.json') || safe.startsWith('.')) { res.writeHead(400); res.end('bad name'); return; }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 8 * 1024 * 1024) { res.writeHead(413); res.end('too large'); return; }
    chunks.push(c);
  }
  const dir = join(root, 'traces');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, safe), Buffer.concat(chunks));
  console.log('bug report saved: traces/' + safe);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, file: 'traces/' + safe }));
}

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (req.method === 'POST' && p.startsWith('/__trace/')) {
      await takeReport(req, res, p.slice('/__trace/'.length));
      return;
    }
    if (p === '/') p = '/index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    // Never cache: regenerating data/names-source.js or editing a js/ file and then
    // seeing the OLD one is a genuinely confusing failure, and there is no build step
    // or content hash to bust a stale copy with.
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
}).listen(port, () => console.log('serving on http://localhost:' + port));
