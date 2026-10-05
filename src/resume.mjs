// Picks up Claude Code sessions the 5-hour limit cut off. A minute after the
// limit resets, each one gets `claude -p --resume <id> continue` in its own
// folder: the same conversation carries on, headless, in the background. The
// VS Code panel or terminal that had it open does not see this live; reopen
// the session from its history to follow along.
//
// Which sessions go is a setting: all, only the ones picked on the phone, or
// none. The phone also gets the list: what is waiting, running, picked up, and
// what will not continue by itself and why.
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';

const MIN = 60e3;
const AFTER = MIN; // let the reset land before asking for more
const GRACE = 3 * 60 * MIN; // a cut-off left this long after its reset was left on purpose
const MAX = 3; // resumes per session; work that keeps hitting the limit stops here
const KEEP = 60 * MIN; // how long a finished resume shows as picked up
const RECENT = 3 * 60 * MIN; // sessions with a reply this recent are in the list, to pick ahead
const SHOW = 24 * 60 * MIN; // a cut-off stays in the list this long after its reset
const PERMISSION_MODES = new Set(['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Most pressing first: what needs you, then what will happen, then the rest.
const ORDER = { stuck: 0, held: 1, running: 2, waiting: 3, done: 4, active: 5 };

export function resumeArgs(stop) {
  const args = ['-p', '--resume', stop.sessionId];
  // The mode it ran in. Without one, anything that needs approval is refused:
  // nobody is there to approve it.
  if (PERMISSION_MODES.has(stop.mode)) args.push('--permission-mode', stop.mode);
  return [...args, 'continue'];
}

// Runs Claude Code headless. On Windows `claude` is usually an npm .cmd shim,
// which only starts through the shell; the session id is checked against UUID
// and the mode against PERMISSION_MODES first, so one joined command line is safe.
export function runClaude(stop) {
  return new Promise((resolve) => {
    const args = resumeArgs(stop);
    const env = { ...process.env };
    // Set when this server was started from inside Claude Code; the child would
    // take itself for a nested session.
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const opts = { cwd: stop.cwd, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] };
    let child;
    try {
      child = process.platform === 'win32' ? spawn(['claude', ...args].join(' '), { ...opts, shell: true }) : spawn('claude', args, opts);
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }
    let err = '';
    child.stderr.on('data', (d) => (err = (err + d).slice(-400)));
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim().split('\n').pop() || 'exit code ' + code }));
  });
}

async function isDir(p) {
  try {
    return p !== '' && (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * stops: () => cut-off sessions from the log tracker.
 * sessions: () => sessions with recent replies, so they can be picked ahead.
 * settings: the mode and the per-session picks (src/settings.mjs).
 * full: () => true while the limits still say the session is used up.
 */
export function createResumer({ stops, sessions = () => [], settings, run = runClaude, now = Date.now, full = () => false, log = () => {} }) {
  const handled = new Set(); // session + reset already acted on
  const counts = new Map(); // session -> times resumed
  const running = new Map(); // session -> { project, since }
  const results = new Map(); // session -> { project, at, end, ok, error } of its last resume

  const key = (s) => s.sessionId + '@' + s.resetsAt;

  function auto(id) {
    const { mode, picks } = settings.get();
    return mode !== 'off' && (picks[id] ?? mode === 'all');
  }

  // Why a cut-off session will not continue by itself whatever the setting says.
  function blocked(s, t) {
    if (handled.has(key(s))) return 'failed'; // resumed, yet still cut off at this reset
    if ((counts.get(s.sessionId) || 0) >= MAX) return 'tries';
    if (t >= s.resetsAt + GRACE) return 'late';
    return null;
  }

  async function resume(s, t) {
    const name = s.project || s.sessionId;
    handled.add(key(s));
    counts.set(s.sessionId, (counts.get(s.sessionId) || 0) + 1);
    running.set(s.sessionId, { project: s.project, since: t });
    log(`Continuing ${name}.`);
    let res;
    try {
      if (!UUID.test(s.sessionId)) res = { ok: false, error: 'not a session id: ' + s.sessionId };
      else if (!(await isDir(s.cwd))) res = { ok: false, error: 'folder is gone: ' + s.cwd };
      else res = await run(s);
    } catch (e) {
      res = { ok: false, error: e.message };
    }
    running.delete(s.sessionId);
    results.set(s.sessionId, { project: s.project, at: t, end: now(), ok: res.ok, error: res.ok ? null : String(res.error).slice(0, 160) });
    log(res.ok ? `${name} finished its turn.` : `${name} did not continue: ${res.error}`);
  }

  function tick() {
    const t = now();
    settings.prune(new Set([...sessions().map((s) => s.sessionId), ...stops().map((s) => s.sessionId)]));
    for (const [id, r] of results) if (t - r.end > SHOW) results.delete(id);
    if (full()) return;
    for (const s of stops()) {
      if (running.has(s.sessionId) || blocked(s, t) || !auto(s.sessionId)) continue;
      if (t >= s.resetsAt + AFTER) resume(s, t);
    }
  }

  /** Continue one cut-off session right away, past the tries and the grace period. */
  function continueNow(id) {
    const s = stops().find((x) => x.sessionId === id);
    if (!s) return 'gone';
    if (running.has(id)) return 'running';
    const t = now();
    if (t < s.resetsAt || full()) return 'limit';
    counts.set(id, 0);
    resume(s, t);
    return 'ok';
  }

  function cutRow(s, t) {
    const row = { id: s.sessionId, project: s.project, cutAt: s.at, resetsAt: s.resetsAt };
    if (running.has(s.sessionId)) return { ...row, state: 'running', at: running.get(s.sessionId).since };
    const why = blocked(s, t);
    if (why) return { ...row, state: 'stuck', reason: why, error: why === 'failed' ? results.get(s.sessionId)?.error ?? null : null };
    return { ...row, state: auto(s.sessionId) ? 'waiting' : 'held' };
  }

  function status() {
    const t = now();
    const rows = new Map();
    for (const s of stops()) if (t - s.resetsAt < SHOW) rows.set(s.sessionId, cutRow(s, t));
    for (const [id, r] of running) if (!rows.has(id)) rows.set(id, { id, project: r.project, state: 'running', at: r.since });
    for (const [id, r] of results) {
      if (!rows.has(id) && t - r.end < KEEP) rows.set(id, { id, project: r.project, state: 'done', at: r.at, ok: r.ok, error: r.error });
    }
    for (const s of sessions()) {
      if (!rows.has(s.sessionId) && t - s.lastAt < RECENT) rows.set(s.sessionId, { id: s.sessionId, project: s.project, state: 'active', at: s.lastAt });
    }
    const { mode, picks } = settings.get();
    const list = [...rows.values()]
      .map((r) => ({ ...r, auto: auto(r.id), pick: picks[r.id] ?? null }))
      .sort((a, b) => ORDER[a.state] - ORDER[b.state] || (b.at || b.cutAt || 0) - (a.at || a.cutAt || 0));
    return { mode, sessions: list };
  }

  const knows = (id) => stops().some((s) => s.sessionId === id) || sessions().some((s) => s.sessionId === id) || running.has(id);

  return { tick, status, continueNow, knows };
}
