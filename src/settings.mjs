// What the phone can change, kept in ~/.crabbyburner.json: whether sessions the
// 5-hour limit cuts off continue by themselves (all, only picked ones, off),
// the choice per session, and the code a phone needs before it may change any
// of it. Anyone on the Wi-Fi can reach the server; only the code holder can steer it.
import { readFileSync, promises as fsp } from 'node:fs';
import { randomInt, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const MIN = 60e3;
export const MODES = ['all', 'pick', 'off'];

export function defaultSettingsFile() {
  return path.join(os.homedir(), '.crabbyburner.json');
}

export function createSettings({ file = defaultSettingsFile() } = {}) {
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(file, 'utf8')) || {};
  } catch {
    // First start, or a file someone broke by hand: start from the defaults.
  }
  const picks = saved.picks && typeof saved.picks === 'object' ? saved.picks : {};
  const state = {
    mode: MODES.includes(saved.mode) ? saved.mode : 'all',
    picks: Object.fromEntries(Object.entries(picks).filter(([, v]) => typeof v === 'boolean')),
    code: /^\d{6}$/.test(saved.code) ? saved.code : String(randomInt(0, 1e6)).padStart(6, '0'),
  };

  let writing = Promise.resolve();
  function save() {
    const body = JSON.stringify(state, null, 2) + '\n';
    writing = writing.then(() => fsp.writeFile(file, body, { mode: 0o600 })).catch(() => {});
    return writing;
  }
  if (saved.code !== state.code) save();

  return {
    get: () => state,
    setMode(mode) {
      state.mode = mode;
      return save();
    },
    /** true or false for this session, null to follow the mode again. */
    pick(id, auto) {
      if (auto === null) delete state.picks[id];
      else state.picks[id] = auto;
      return save();
    },
    /** Forgets choices for sessions no longer in the logs. */
    prune(known) {
      const gone = Object.keys(state.picks).filter((id) => !known.has(id));
      for (const id of gone) delete state.picks[id];
      if (gone.length) save();
    },
  };
}

// Five wrong codes in ten minutes locks changes until the ten minutes are up,
// which puts guessing a six-digit code out of reach.
export function createDoor({ code, now = Date.now }) {
  let wrong = 0;
  let since = 0;
  return function check(given) {
    const t = now();
    if (t - since > 10 * MIN) {
      wrong = 0;
      since = t;
    }
    if (wrong >= 5) return 'locked';
    const a = Buffer.from(String(given ?? ''));
    const b = Buffer.from(code());
    if (a.length === b.length && timingSafeEqual(a, b)) return 'ok';
    wrong++;
    return 'wrong';
  };
}
