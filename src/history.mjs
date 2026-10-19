// Looks further back than the live tracker: tokens per day from every Claude
// Code log still on disk, and the plan limits as CrabbyBurner sees them over
// time. Claude Code deletes old logs (cleanupPeriodDays, 30 days by default),
// so the day totals are also kept in ~/.crabbyburner-history.json; a day never
// shrinks when its logs disappear.
import { readFileSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { defaultLogRoot, projectName } from './logs.mjs';

const DAY = 864e5;
const LIST_EVERY = 60e3;
const SAVE_EVERY = 5 * 60e3;
const CHUNK = 1 << 20;
const NEEDLE = Buffer.from('"output_tokens"');
const SHOW_DAYS = 28;
const SHOW_WEEKS = 12;

export function defaultHistoryFile() {
  return path.join(os.homedir(), '.crabbyburner-history.json');
}

/** Local calendar day, 'YYYY-MM-DD'. */
export function dayKey(t) {
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** The Monday (local) of the week a day falls in, as a day key. */
export function weekKey(day) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(d - ((date.getDay() + 6) % 7));
  return dayKey(date.getTime());
}

function shiftDay(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n).getTime());
}

function emptyDay() {
  return { tokens: 0, output: 0, replies: 0, projects: {} };
}

// Larger of the two, field by field: the logs may have lost old files, the file
// may be behind on today.
function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  const projects = { ...a.projects };
  for (const [name, n] of Object.entries(b.projects || {})) projects[name] = Math.max(projects[name] || 0, n);
  const out = { tokens: Math.max(a.tokens, b.tokens), output: Math.max(a.output, b.output), replies: Math.max(a.replies, b.replies), projects };
  for (const k of ['session', 'weekly']) {
    if (typeof a[k] === 'number' || typeof b[k] === 'number') out[k] = Math.max(a[k] ?? 0, b[k] ?? 0);
  }
  return out;
}

function readSaved(file) {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8'));
    return { days: o && typeof o.days === 'object' ? o.days : {}, limitWeeks: o && typeof o.limitWeeks === 'object' ? o.limitWeeks : {} };
  } catch {
    return { days: {}, limitWeeks: {} };
  }
}

export function createHistory({ root = defaultLogRoot(), file = defaultHistoryFile(), now = Date.now } = {}) {
  const saved = readSaved(file);
  const scanned = new Map(); // day -> totals counted from the logs this run
  const peaks = new Map(); // day -> { session, weekly } seen this run
  const offsets = new Map();
  const seen = new Set();
  let files = [];
  let listedAt = 0;
  let running = null;
  let ready = false;
  let savedAt = 0;
  let dirty = false;

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
    if (!(t > 0)) return;
    if (m.id) {
      const key = m.id + ':' + (o.requestId || '');
      if (seen.has(key)) return;
      seen.add(key);
    }
    const total = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    const day = dayKey(t);
    if (!scanned.has(day)) scanned.set(day, emptyDay());
    const d = scanned.get(day);
    d.tokens += total;
    d.output += u.output_tokens || 0;
    d.replies++;
    const project = projectName(o.cwd || '', folder) || folder;
    d.projects[project] = (d.projects[project] || 0) + total;
    dirty = true;
  }

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

  async function scan() {
    const t = now();
    if (t - listedAt > LIST_EVERY) {
      files = await listFiles();
      listedAt = t;
    }
    for (const f of files) {
      let st;
      try {
        st = await fsp.stat(f);
      } catch {
        offsets.delete(f);
        continue;
      }
      // A rewritten log is read again; the reply ids keep it from counting twice.
      let offset = offsets.get(f) || 0;
      if (st.size < offset) offset = 0;
      if (st.size > offset) {
        try {
          offset += await readNew(f, offset, st.size);
        } catch {
          continue;
        }
      }
      offsets.set(f, offset);
    }
    ready = true;
    if (dirty && now() - savedAt > SAVE_EVERY) await save();
  }

  function days() {
    const all = new Set([...Object.keys(saved.days), ...scanned.keys(), ...peaks.keys()]);
    const out = new Map();
    for (const day of all) out.set(day, merge(merge(saved.days[day], scanned.get(day)), peaks.get(day) && { ...emptyDay(), ...peaks.get(day) }));
    return out;
  }

  async function save() {
    savedAt = now();
    dirty = false;
    const body = JSON.stringify({ days: Object.fromEntries([...days()].sort()), limitWeeks: saved.limitWeeks }) + '\n';
    try {
      await fsp.writeFile(file, body, { mode: 0o600 });
    } catch {
      // Not being able to keep history should not stop the display.
    }
  }

  function refresh() {
    if (!running) running = scan().finally(() => (running = null));
    return running;
  }

  /** Remembers the highest session and weekly percentage seen per day, and per limit week. */
  function noteLimits(lim) {
    if (!lim || lim.error) return;
    const day = dayKey(now());
    const p = peaks.get(day) || {};
    if (lim.session && typeof lim.session.percent === 'number') p.session = Math.max(p.session ?? 0, lim.session.percent);
    if (lim.weekly && typeof lim.weekly.percent === 'number') {
      p.weekly = Math.max(p.weekly ?? 0, lim.weekly.percent);
      if (lim.weekly.resetsAt) {
        const key = lim.weekly.resetsAt;
        saved.limitWeeks[key] = Math.max(saved.limitWeeks[key] ?? 0, lim.weekly.percent);
      }
    }
    peaks.set(day, p);
    dirty = true;
  }

  function snapshot() {
    const all = days();
    const today = dayKey(now());
    const total = (day) => (all.get(day) || emptyDay()).tokens;

    const dayList = [];
    for (let i = SHOW_DAYS - 1; i >= 0; i--) {
      const day = shiftDay(today, -i);
      const d = all.get(day) || emptyDay();
      dayList.push({ day, tokens: d.tokens, output: d.output, replies: d.replies, session: d.session ?? null, weekly: d.weekly ?? null });
    }

    const weekTotals = new Map();
    for (const [day, d] of all) {
      const w = weekKey(day);
      const x = weekTotals.get(w) || { tokens: 0, replies: 0, projects: {} };
      x.tokens += d.tokens;
      x.replies += d.replies;
      for (const [name, n] of Object.entries(d.projects || {})) x.projects[name] = (x.projects[name] || 0) + n;
      weekTotals.set(w, x);
    }
    const thisWeek = weekKey(today);
    const weeks = [];
    for (let i = SHOW_WEEKS - 1; i >= 0; i--) {
      const start = shiftDay(thisWeek, -7 * i);
      const w = weekTotals.get(start) || { tokens: 0, replies: 0 };
      weeks.push({ start, tokens: w.tokens, replies: w.replies });
    }

    // This week so far against last week up to the same weekday.
    const into = Math.round((Date.parse(today + 'T12:00') - Date.parse(thisWeek + 'T12:00')) / DAY);
    let soFar = 0;
    let lastSoFar = 0;
    for (let i = 0; i <= into; i++) {
      soFar += total(shiftDay(thisWeek, i));
      lastSoFar += total(shiftDay(thisWeek, i - 7));
    }
    const lastWeek = weekTotals.get(shiftDay(thisWeek, -7));

    let bestWeek = null;
    for (const [start, w] of weekTotals) if (w.tokens && (!bestWeek || w.tokens > bestWeek.tokens)) bestWeek = { start, tokens: w.tokens };
    let bestDay = null;
    for (const [day, d] of all) if (d.tokens && (!bestDay || d.tokens > bestDay.tokens)) bestDay = { day, tokens: d.tokens };

    const allProjects = {};
    for (const d of all.values()) for (const [name, n] of Object.entries(d.projects || {})) allProjects[name] = (allProjects[name] || 0) + n;
    const top = (o) =>
      Object.entries(o || {})
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, tokens]) => ({ name, tokens }));

    const since = [...all.keys()].filter((k) => all.get(k).tokens > 0).sort()[0] || null;
    const limitWeeks = Object.entries(saved.limitWeeks)
      .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))
      .slice(-SHOW_WEEKS)
      .map(([resetsAt, peak]) => ({ resetsAt, peak }));

    return {
      ready,
      since,
      today,
      days: dayList,
      weeks,
      compare: { thisWeek: soFar, lastWeek: lastSoFar, lastWeekTotal: lastWeek ? lastWeek.tokens : 0, weekday: into },
      best: { week: bestWeek, day: bestDay },
      projects: { week: top((weekTotals.get(thisWeek) || {}).projects), all: top(allProjects) },
      limitWeeks,
    };
  }

  return { refresh, snapshot, noteLimits, save, isReady: () => ready };
}
