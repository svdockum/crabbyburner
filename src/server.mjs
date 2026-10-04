// CrabbyBurner: serves the phone page and /api/usage on the local network.
import http from 'node:http';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLogTracker } from './logs.mjs';
import { createLimits } from './limits.mjs';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

// Maps a URL path onto a file inside public/, or null when it would escape it.
export function resolveStatic(urlPath, root = PUBLIC) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  const base = path.resolve(root);
  return file.startsWith(base + path.sep) && TYPES[path.extname(file)] ? file : null;
}

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

export function createApp({ logs = createLogTracker(), limits = createLimits() } = {}) {
  let scannedAt = 0;

  async function usage() {
    limits.refresh();
    // The first scan reads a week of logs; answer straight away and let it finish.
    if (logs.isReady()) {
      if (Date.now() - scannedAt > 2000) {
        scannedAt = Date.now();
        await logs.refresh();
      }
    } else {
      logs.refresh();
    }
    return { now: Date.now(), limits: limits.get(), logs: logs.snapshot() };
  }

  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (req.url.split('?')[0] === '/api/usage') {
      const body = JSON.stringify(await usage());
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    const file = resolveStatic(req.url);
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    try {
      const data = await fsp.readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404).end();
    }
  }

  // Warm both sources so the phone's first request has something to show.
  logs.refresh();
  limits.refresh();

  return http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const port = Number(process.env.PORT) || 2722;
  const host = process.env.HOST || '0.0.0.0';
  const server = createApp();
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port} is taken. Try PORT=2723 npm start.` : err.message);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const lan = lanAddresses();
    console.log('\n  CrabbyBurner is up.\n');
    console.log(`  This PC     http://localhost:${port}`);
    for (const ip of lan) console.log(`  Your phone  http://${ip}:${port}`);
    console.log('\n  Phone and PC need to be on the same Wi-Fi. If the phone cannot connect,');
    console.log('  allow Node.js on private networks in Windows Firewall.');
    console.log('  Tip: Android Developer options > Stay awake keeps the screen on while charging.\n');
  });
}
