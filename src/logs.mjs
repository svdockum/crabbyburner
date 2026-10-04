// Reads Claude Code's session logs (~/.claude/projects/**/*.jsonl) incrementally
// and keeps a rolling week of per-reply token usage in memory.
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MIN = 60e3;
const DAY = 24 * 60 * MIN;
const WINDOW = 7 * DAY;
const LIST_EVERY = 15e3;
const CHUNK = 1 << 20;
const NEEDLE = Buffer.from('"output_tokens"');

export function defaultLogRoot() {
  return path.join(os.homedir(), '.claude', 'projects');
}

// Claude Code logs the shell's current folder, which wanders into subfolders.
// The log's own folder name is the session's project path with every
// non-alphanumeric character turned into '-', so walk up until it matches.
export function projectName(cwd, folder) {
  if (!cwd) return null;
  const want = String(folder || '').toLowerCase();
  let p = cwd;
  while (want) {
    if (p.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() === want) return path.basename(p) || p;
    const up = path.dirname(p);
    if (up === p) break;
    p = up;
  }
  return path.basename(cwd) || cwd;
}

export function createLogTracker({ root = defaultLogRoot(), now = Date.now } = {}) {
  const offsets = new Map(); // file -> bytes consumed
  const seen = new Map(); // message id + request id -> timestamp
  let events = [];
  let files = [];
  let listedAt = 0;
  let running = null;
  let ready = false;
  const names = new Map(); // folder + cwd -> project name

  function nameFor(cwd, folder) {
    const key = folder + '|' + cwd;
    if (!names.has(key)) names.set(key, projectName(cwd, folder));
    return names.get(key);
  }

  async function listFiles() {
    try {
      const names = await fsp.readdir(root, { recursive: true });
      return names.filter((n) => n.endsWith('.jsonl')).map((n) => path.join(root, n));
    } catch {
      return [];
    }
  }

  function ingest(text, folder) {
    let o;
    try {
      o = JSON.parse(text);
    } catch {
      return;
    }
    const m = o && o.type === 'assistant' ? o.message : null;
    const u = m && m.usage;
    if (!u || m.model === '<synthetic>') return;
    const t = Date.parse(o.timestamp);
    if (!(t > now() - WINDOW)) return;
    // Claude Code writes one line per content block, each repeating the reply's usage.
    if (m.id) {
      const key = m.id + ':' + (o.requestId || '');
      if (seen.has(key)) return;
      seen.set(key, t);
    }
    events.push({
      t,
      model: m.model || '',
      project: nameFor(o.cwd || '', folder),
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
    });
  }

  // Reads [start, end) and returns how many bytes ended in a complete line.
  // A half-written last line stays unconsumed and is read again next time.
  async function readNew(file, start, end) {
    const folder = path.relative(root, file).split(path.sep)[0];
    const fh = await fsp.open(file, 'r');
    let pos = start;
    let carry = Buffer.alloc(0);
    try {
      while (pos < end) {
        const len = Math.min(CHUNK, end - pos);
        const buf = Buffer.allocUnsafe(len);
        const { bytesRead } = await fh.read(buf, 0, len, pos);
        if (!bytesRead) break;
        pos += bytesRead;
        const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
        let from = 0;
        let nl;
        while ((nl = data.indexOf(10, from)) !== -1) {
          const line = data.subarray(from, nl);
          if (line.includes(NEEDLE)) ingest(line.toString('utf8'), folder);
          from = nl + 1;
        }
        carry = data.subarray(from);
      }
    } finally {
      await fh.close();
    }
    return pos - start - carry.length;
  }

  function prune(t) {
    const cutoff = t - WINDOW;
    if (events.length && events.some((e) => e.t <= cutoff)) events = events.filter((e) => e.t > cutoff);
    for (const [key, ts] of seen) if (ts <= cutoff) seen.delete(key);
  }

  async function scan() {
    const t = now();
    if (t - listedAt > LIST_EVERY) {
      files = await listFiles();
      listedAt = t;
    }
    for (const file of files) {
      let st;
      try {
        st = await fsp.stat(file);
      } catch {
        offsets.delete(file);
        continue;
      }
      let offset = offsets.get(file);
      // A log untouched for a week holds nothing we show; only read what gets appended later.
      if (offset === undefined) offset = st.mtimeMs < t - WINDOW ? st.size : 0;
      if (st.size < offset) offset = 0;
      if (st.size > offset) {
        try {
          offset += await readNew(file, offset, st.size);
        } catch {
          continue;
        }
      }
      offsets.set(file, offset);
    }
    prune(t);
    ready = true;
  }

  function refresh() {
    if (!running) running = scan().finally(() => (running = null));
    return running;
  }

  function snapshot() {
    const t = now();
    const midnight = new Date(t);
    midnight.setHours(0, 0, 0, 0);
    const start = midnight.getTime();

    const today = { tokens: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, replies: 0, projects: 0, hourly: new Array(24).fill(0) };
    const week = { tokens: 0, replies: 0 };
    const projectsToday = new Set();
    const active = new Map();
    let last = null;
    let replies2m = 0;
    let output2m = 0;

    for (const e of events) {
      const total = e.input + e.output + e.cacheWrite + e.cacheRead;
      week.tokens += total;
      week.replies++;
      if (e.t >= start) {
        today.tokens += total;
        today.input += e.input;
        today.output += e.output;
        today.cacheWrite += e.cacheWrite;
        today.cacheRead += e.cacheRead;
        today.replies++;
        today.hourly[new Date(e.t).getHours()] += total;
        if (e.project) projectsToday.add(e.project);
      }
      if (e.t > t - 2 * MIN) {
        replies2m++;
        output2m += e.output;
      }
      if (e.t > t - 10 * MIN && e.project) active.set(e.project, Math.max(active.get(e.project) || 0, e.t));
      if (!last || e.t > last.t) last = e;
    }
    today.projects = projectsToday.size;

    return {
      ready,
      today,
      week,
      pulse: { replies2m, outputPerMin: Math.round(output2m / 2) },
      last: last ? { at: last.t, project: last.project, model: last.model } : null,
      active: [...active.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    };
  }

  return { refresh, snapshot, isReady: () => ready };
}
