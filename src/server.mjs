// CrabbyBurner: serves the phone page and /api/usage on the local network, and
// takes the phone's auto-continue settings at /api/resume.
import http from 'node:http';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLogTracker } from './logs.mjs';
import { createLimits } from './limits.mjs';
import { createResumer } from './resume.mjs';
import { createDoor, createSettings, MODES } from './settings.mjs';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MODE_TEXT = { all: 'every cut-off session', pick: 'only sessions picked on the phone', off: 'off' };

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

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(new Error('too big'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createApp({ logs = createLogTracker(), limits = createLimits(), settings = createSettings(), log = () => {} } = {}) {
  let scannedAt = 0;
  const resumer = createResumer({
    stops: logs.stops,
    sessions: logs.sessions,
    settings,
    // No point asking while the limits still say the session is used up.
    full: () => {
      const s = limits.get().session;
      return !!s && s.percent >= 100 && Date.parse(s.resetsAt) > Date.now();
    },
    log,
  });
  const door = createDoor({ code: () => settings.get().code });

  // { mode }, { session, auto: true | false | null } or { session, now: true }.
  // An empty body only checks the code.
  async function change(req, res) {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const gate = door(req.headers['x-crabby-code']);
    if (gate !== 'ok') {
      log(`Wrong phone code from ${req.socket.remoteAddress}${gate === 'locked' ? '; changes locked for a few minutes' : ''}.`);
      return send(gate === 'locked' ? 429 : 403, { error: gate === 'locked' ? 'locked' : 'code' });
    }
    let body;
    try {
      body = JSON.parse((await readBody(req, 2048)) || '{}');
    } catch {
      return send(400, { error: 'body' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'body' });
    if ('mode' in body) {
      if (!MODES.includes(body.mode)) return send(400, { error: 'mode' });
      await settings.setMode(body.mode);
      log(`Auto-continue: ${MODE_TEXT[body.mode]}.`);
    }
    if ('session' in body) {
      if (typeof body.session !== 'string' || !resumer.knows(body.session)) return send(404, { error: 'session' });
      if ('auto' in body) {
        if (![true, false, null].includes(body.auto)) return send(400, { error: 'auto' });
        await settings.pick(body.session, body.auto);
      }
      if (body.now === true) {
        const r = resumer.continueNow(body.session);
        if (r !== 'ok') return send(409, { error: r, resume: resumer.status() });
      }
    }
    send(200, { resume: resumer.status() });
  }

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
    return { now: Date.now(), limits: limits.get(), logs: logs.snapshot(), resume: resumer.status() };
  }

  async function handle(req, res) {
    const route = req.url.split('?')[0];
    if (route === '/api/resume' && req.method === 'POST') return change(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (route === '/api/usage') {
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

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  // Cut-off sessions get picked up whether or not a phone is watching.
  const watcher = setInterval(() => logs.refresh().then(resumer.tick, () => {}), 30e3);
  server.on('close', () => clearInterval(watcher));
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const port = Number(process.env.PORT) || 2722;
  const host = process.env.HOST || '0.0.0.0';
  const clock = () => new Date().toTimeString().slice(0, 5);
  const settings = createSettings();
  const server = createApp({ settings, log: (m) => console.log(`  ${clock()}  ${m}`) });
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
    const { mode, code } = settings.get();
    console.log(`  Auto-continue after the 5-hour limit: ${MODE_TEXT[mode]}. Change it in the app.`);
    console.log(`  Phone code: ${code.slice(0, 3)} ${code.slice(3)}  (the app asks for it once, before it changes anything)`);
    console.log('  Keep this window open; it does the continuing.\n');
  });
}
