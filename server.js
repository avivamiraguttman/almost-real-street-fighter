// Static file server + POST /log that writes gameplay logs to ./logs/. Run: node server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PORT = +(process.env.PORT || 8000);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg', '.css': 'text/css', '.task': 'application/octet-stream', '.wasm': 'application/wasm' };
fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/log') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const name = `fightlog-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      fs.writeFileSync(path.join(ROOT, 'logs', name), Buffer.concat(chunks));
      console.log('saved', name, Buffer.concat(chunks).length, 'bytes');
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, name }));
    });
    return;
  }
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`FightCam on http://127.0.0.1:${PORT}/`));
